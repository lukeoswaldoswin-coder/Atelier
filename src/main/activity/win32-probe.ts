import koffi from 'koffi'
import { basename } from 'node:path'

export interface ActivitySample {
  /** 前台进程的可执行文件名（仅文件名，不含路径） */
  processName: string | null
  idleMs: number
}

export interface ActivityProbe {
  sample(): ActivitySample
  dispose(): void
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const BUFFER_CHARS = 16_384
const TICK32_MOD = 0x1_0000_0000

/**
 * 系统空闲毫秒。
 *
 * GetLastInputInfo 的 dwTime 是 32 位 GetTickCount（约 49.7 天回绕一次），
 * 而当前时间取的是 64 位 GetTickCount64；直接相减会在开机超过 49.7 天后
 * 得到一个巨大的空闲值，导致监测把用户一直判定为空闲、不再累计工时。
 * 这里统一按 32 位无符号减法计算差值，回绕前后都正确。
 */
export function computeIdleMs(tick64Ms: number, lastInputTick32: number): number {
  if (!Number.isFinite(tick64Ms) || !Number.isFinite(lastInputTick32)) return 0
  const now32 = ((tick64Ms % TICK32_MOD) + TICK32_MOD) % TICK32_MOD
  const last32 = ((lastInputTick32 % TICK32_MOD) + TICK32_MOD) % TICK32_MOD
  return (now32 - last32) >>> 0
}

/**
 * Windows 原生探测：只读取前台进程名与系统空闲毫秒。
 * 不读取窗口标题、文件路径、键盘或鼠标内容，不截屏。
 */
export function createWin32Probe(): ActivityProbe {
  if (process.platform !== 'win32') {
    throw new Error('活动探测仅支持 Windows')
  }

  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const LASTINPUTINFO = koffi.struct('LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' })

  const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'
  )
  const OpenProcess = kernel32.func(
    'void * __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'
  )
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32 *lpdwSize)'
  )
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)')
  const GetTickCount64 = kernel32.func('uint64 __stdcall GetTickCount64()')
  const GetLastInputInfo = user32.func(
    'bool __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *plii)'
  )

  return {
    sample(): ActivitySample {
      const hwnd = GetForegroundWindow()
      if (!hwnd) return { processName: null, idleMs: readIdleMs() }

      const pidOut = [0]
      GetWindowThreadProcessId(hwnd, pidOut)
      const pid = pidOut[0]
      if (!pid) return { processName: null, idleMs: readIdleMs() }

      let processName: string | null = null
      const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
      if (handle) {
        try {
          const buffer = Buffer.alloc(BUFFER_CHARS * 2)
          const size = [BUFFER_CHARS]
          if (QueryFullProcessImageNameW(handle, 0, buffer, size)) {
            const fullPath = koffi.decode(buffer, 'char16', size[0] ?? 0)
            processName = basename(fullPath)
          }
        } finally {
          CloseHandle(handle)
        }
      }

      return { processName, idleMs: readIdleMs() }
    },

    dispose(): void {
      // koffi 加载的库句柄由进程生命周期管理，无需显式释放
    }
  }

  function readIdleMs(): number {
    const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 }
    if (!GetLastInputInfo(info)) return 0
    return computeIdleMs(Number(GetTickCount64()), info.dwTime)
  }
}
