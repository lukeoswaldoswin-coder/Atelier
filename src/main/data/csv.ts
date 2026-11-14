/**
 * CSV 输出工具。
 *
 * 安全要点：用户可控文本先做 Excel 公式注入防护（前导单引号），再做 RFC 4180
 * 引号转义。仅靠引号不能阻止 Excel 把 =cmd 当公式执行。
 * 编码：UTF-8 BOM + CRLF，方便中文 Windows Excel 直接打开。
 */

const DANGEROUS_START = /^[=+\-@]/
const LEADING_WHITESPACE = /^[\s\u00a0\ufeff]+/
const LINE_BREAK = /\r\n|\r|\n/

/** 判断单行是否可能被 Excel 解释为公式。 */
function lineIsDangerous(line: string): boolean {
  return DANGEROUS_START.test(line.replace(LEADING_WHITESPACE, ''))
}

export function protectCsvFormula(value: string): string {
  if (value.length === 0) return value

  // 以制表符/CR/LF 开头时，Excel 可能忽略前导空白后执行公式
  if (/^[\t\r\n]/.test(value)) return `'${value}`
  if (DANGEROUS_START.test(value)) return `'${value}`
  if (lineIsDangerous(value)) return `'${value}`

  // 多行文本逐行检查：任一行以危险字符开头都整体加前缀
  const lines = value.split(LINE_BREAK)
  if (lines.some((line) => lineIsDangerous(line))) return `'${value}`

  return value
}

/** 文本单元格：防护 + 强制引号（保留换行、逗号、双引号）。 */
export function csvText(value: string): string {
  const protectedValue = protectCsvFormula(value)
  return `"${protectedValue.replace(/"/g, '""')}"`
}

/** 数值单元格：不引号、不加前导单引号。 */
export function csvNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return String(value)
}

/** 金额：分 → 两位小数元。 */
export function centsToYuan(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2)
}

export function csvTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map((header) => csvText(header)).join(',')]
  for (const row of rows) {
    lines.push(row.join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
