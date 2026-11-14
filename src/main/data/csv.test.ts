import { describe, expect, it } from 'vitest'
import { csvNumber, csvTable, csvText, protectCsvFormula } from './csv'

describe('CSV 公式注入防护', () => {
  it.each([
    '=SUM(A1)',
    '+1+1',
    '-2+3',
    '@SUM(A1)',
    '  =SUM(A1)',
    '\t@SUM(A1)',
    '\r=cmd',
    '\n+cmd',
    '\u00a0@cmd',
    'safe\n=cmd'
  ])('危险文本 %j 会加前导单引号', (value) => {
    expect(protectCsvFormula(value).startsWith("'")).toBe(true)
  })

  it('正常文本、空字符串、已安全文本不改变', () => {
    expect(protectCsvFormula('三狼')).toBe('三狼')
    expect(protectCsvFormula('')).toBe('')
    expect(protectCsvFormula('已加前缀 \'=1')).toBe("已加前缀 '=1")
  })

  it('文本单元格做公式防护并转义引号/逗号/换行', () => {
    expect(csvText('=1,2')).toBe('"\'=1,2"')
    expect(csvText('a"b')).toBe('"a""b"')
    expect(csvText('line1\nline2')).toBe('"line1\nline2"')
  })

  it('数值单元格不加强制前缀', () => {
    expect(csvNumber(-5)).toBe('-5')
    expect(csvNumber(120)).toBe('120')
    expect(csvNumber(null)).toBe('')
  })

  it('输出 UTF-8 BOM、CRLF 与表头', () => {
    const content = csvTable(['客户ID', '客户名称'], [[csvText('1'), csvText('三狼')]])
    expect(content.charCodeAt(0)).toBe(0xfeff)
    expect(content).toContain('\r\n')
    expect(content.startsWith('\uFEFF"客户ID","客户名称"\r\n')).toBe(true)
  })
})
