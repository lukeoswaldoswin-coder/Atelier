/**
 * 金额输入解析（元 → 整数分）。
 *
 * 全部用字符串处理，**不做任何浮点运算**，避免 0.1 + 0.2 这类误差。
 * 允许用户输入千分位逗号与常见货币符号，但只接受最多两位小数。
 */

export type ParseYuanFailure =
  | 'empty'
  | 'invalid'
  | 'negative'
  | 'too-many-decimals'
  | 'too-large'

export type ParseYuanResult =
  | { ok: true; cents: number }
  | { ok: false; reason: ParseYuanFailure }

export const PARSE_YUAN_ERROR_MESSAGES: Record<ParseYuanFailure, string> = {
  empty: '请输入金额，或选择「未报价」/「免费」',
  invalid: '金额格式不正确，请输入数字',
  negative: '金额不能为负数',
  'too-many-decimals': '金额最多保留两位小数',
  'too-large': '金额过大'
}

export function parseYuanToCents(input: string): ParseYuanResult {
  const cleaned = input.trim().replace(/[,\s]/g, '').replace(/^[¥￥]/, '')

  if (cleaned.length === 0) return { ok: false, reason: 'empty' }
  if (cleaned.startsWith('-')) return { ok: false, reason: 'negative' }
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === '.') {
    return { ok: false, reason: 'invalid' }
  }

  const [integerRaw = '', fractionRaw = ''] = cleaned.split('.')
  if (fractionRaw.length > 2) return { ok: false, reason: 'too-many-decimals' }

  const integerPart = integerRaw.length === 0 ? '0' : integerRaw
  if (integerPart.length > 12) return { ok: false, reason: 'too-large' }

  const cents = Number(integerPart) * 100 + Number((fractionRaw + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'too-large' }

  return { ok: true, cents }
}

/** 整数分 → 输入框里的纯数字文本（不带 ¥ 与千分位），例如 120050 → `1200.50`。 */
export function centsToYuanInput(cents: number): string {
  const rounded = Math.round(cents)
  const negative = rounded < 0
  const absolute = Math.abs(rounded)
  const yuan = Math.floor(absolute / 100)
  const fen = String(absolute % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${yuan}.${fen}`
}
