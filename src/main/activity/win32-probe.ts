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
    const tick = Number(GetTickCount64())
    return Math.max(0, tick - info.dwTime)
  }
}
