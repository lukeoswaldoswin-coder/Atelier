export type LoadStatus = 'loading' | 'ready' | 'error'

export interface LoadableList<T> {
  status: LoadStatus
  rows: T[]
  error: string | null
}

export function emptyListState<T>(): LoadableList<T> {
  return { status: 'loading', rows: [], error: null }
}
