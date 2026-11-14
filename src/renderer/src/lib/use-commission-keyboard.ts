import { useCallback, useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Commission } from '@shared/domain'

/** 输入法组合输入期间（或对应的 229 键）不处理快捷键。 */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** 焦点是否在可编辑控件上（输入框、文本域、下拉、contenteditable）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  const editable = target.getAttribute('contenteditable')
  return editable !== null && editable !== 'false'
}

interface CommissionKeyboardOptions {
  /** 详情/编辑面板打开时应为 false，避免与面板内部操作冲突 */
  enabled: boolean
  rows: readonly Commission[]
  activeId: string | null
  onActivate: (id: string) => void
  onOpen: (id: string) => void
  onFocusSearch: () => void
  /** 面板关闭时按 Esc：清空搜索（没有搜索内容时由调用方忽略） */
  onEscape: () => void
}

/**
 * 委托列表快捷键。
 *
 * - Ctrl/Cmd+K：聚焦搜索（仅在面板关闭时生效）
 * - Esc：面板关闭时清空搜索内容（详情面板打开时由 Dialog 自行处理，这里不介入）
 * - ↑/↓：移动列表高亮，不打开详情
 * - Enter：仅在列表容器自身获得焦点时打开选中项（行按钮自身的 Enter 交给原生 click）
 *
 * 统一跳过：输入法组合中、可编辑控件内、默认行为已被阻止、面板打开时。
 */
export function useCommissionKeyboard(options: CommissionKeyboardOptions) {
  const { enabled, rows, activeId, onActivate, onOpen, onFocusSearch, onEscape } = options

  useEffect(() => {
    function handleGlobal(event: KeyboardEvent) {
      if (!enabled || isImeComposing(event) || isEditableTarget(event.target) || event.defaultPrevented) {
        return
      }
      if (event.key === 'Escape') {
        onEscape()
        return
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        onFocusSearch()
      }
    }

    window.addEventListener('keydown', handleGlobal)
    return () => window.removeEventListener('keydown', handleGlobal)
  }, [enabled, onFocusSearch, onEscape])

  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled || isImeComposing(event.nativeEvent) || isEditableTarget(event.target)) return
      if (event.defaultPrevented || rows.length === 0) return

      if (event.key === 'Enter') {
        // 聚焦在行按钮上时由原生 click 处理，避免重复打开
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        const id = activeId ?? rows[0]?.id
        if (id) onOpen(id)
        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      event.preventDefault()
      const currentIndex = rows.findIndex((row) => row.id === activeId)
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, rows.length - 1)
          : Math.max((currentIndex <= 0 ? 0 : currentIndex) - 1, 0)
      const next = rows[nextIndex]
      if (next) onActivate(next.id)
    },
    [enabled, rows, activeId, onActivate, onOpen]
  )

  return { handleListKeyDown }
}
