import { describe, expect, it } from 'vitest'
import { isEditableTarget, isImeComposing } from './use-commission-keyboard'

describe('快捷键输入保护', () => {
  it('输入法组合中不处理快捷键', () => {
    expect(isImeComposing(new KeyboardEvent('keydown', { isComposing: true }))).toBe(true)
    expect(isImeComposing(new KeyboardEvent('keydown'))).toBe(false)

    const legacy = new KeyboardEvent('keydown')
    Object.defineProperty(legacy, 'keyCode', { value: 229 })
    expect(isImeComposing(legacy)).toBe(true)
  })

  it('可编辑控件上的按键不拦截', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const plain = document.createElement('div')

    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(select)).toBe(true)
    expect(isEditableTarget(editable)).toBe(true)
    expect(isEditableTarget(plain)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
