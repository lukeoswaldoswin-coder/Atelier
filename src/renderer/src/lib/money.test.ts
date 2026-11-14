import { describe, expect, it } from 'vitest'
import { PARSE_YUAN_ERROR_MESSAGES, centsToYuanInput, parseYuanToCents } from './money'

describe('金额解析：元 → 整数分', () => {
  it('整数与小数都正确换算', () => {
    expect(parseYuanToCents('0')).toEqual({ ok: true, cents: 0 })
    expect(parseYuanToCents('12')).toEqual({ ok: true, cents: 1200 })
    expect(parseYuanToCents('12.3')).toEqual({ ok: true, cents: 1230 })
    expect(parseYuanToCents('12.34')).toEqual({ ok: true, cents: 1234 })
    expect(parseYuanToCents('0.05')).toEqual({ ok: true, cents: 5 })
  })

  it('容忍千分位逗号、货币符号与首尾空格', () => {
    expect(parseYuanToCents(' 1,200.50 ')).toEqual({ ok: true, cents: 120050 })
    expect(parseYuanToCents('¥1200')).toEqual({ ok: true, cents: 120000 })
    expect(parseYuanToCents('￥1,000')).toEqual({ ok: true, cents: 100000 })
  })

  it('省略整数或小数部分也能解析', () => {
    expect(parseYuanToCents('.5')).toEqual({ ok: true, cents: 50 })
    expect(parseYuanToCents('1.')).toEqual({ ok: true, cents: 100 })
  })

  it('不使用浮点运算（经典精度问题不会出现）', () => {
    expect(parseYuanToCents('0.1')).toEqual({ ok: true, cents: 10 })
    expect(parseYuanToCents('0.2')).toEqual({ ok: true, cents: 20 })
    expect(parseYuanToCents('19.99')).toEqual({ ok: true, cents: 1999 })
    expect(parseYuanToCents('1234567.89')).toEqual({ ok: true, cents: 123456789 })
  })

  it('拒绝空值与格式错误', () => {
    expect(parseYuanToCents('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseYuanToCents('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(parseYuanToCents('abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseYuanToCents('1.2.3')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseYuanToCents('.')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('拒绝负数与超过两位小数', () => {
    expect(parseYuanToCents('-1')).toEqual({ ok: false, reason: 'negative' })
    expect(parseYuanToCents('12.345')).toEqual({ ok: false, reason: 'too-many-decimals' })
  })

  it('拒绝超出安全范围的金额', () => {
    expect(parseYuanToCents('9999999999999')).toEqual({ ok: false, reason: 'too-large' })
  })

  it('每种失败都有可读提示', () => {
    expect(PARSE_YUAN_ERROR_MESSAGES.empty).toContain('金额')
    expect(PARSE_YUAN_ERROR_MESSAGES['too-many-decimals']).toContain('两位小数')
    expect(PARSE_YUAN_ERROR_MESSAGES.negative).toContain('负数')
  })
})

describe('整数分 → 输入框文本', () => {
  it('补足两位小数', () => {
    expect(centsToYuanInput(0)).toBe('0.00')
    expect(centsToYuanInput(5)).toBe('0.05')
    expect(centsToYuanInput(50)).toBe('0.50')
    expect(centsToYuanInput(120050)).toBe('1200.50')
    expect(centsToYuanInput(123456789)).toBe('1234567.89')
  })
})
