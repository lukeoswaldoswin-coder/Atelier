/**
 * 数据层可以主动抛出的“业务错误”。
 *
 * 与普通异常的区别：这类错误的 message 是给用户看的、可以安全地传回渲染进程；
 * 而其他异常（SQL 语句错误、文件损坏等）只在主进程记录，对外统一返回通用错误。
 */
export class DataError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DataError'
    this.code = code
  }
}
