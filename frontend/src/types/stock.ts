import type { DeveloperCategory } from './developer'

export interface StockSolution {
  id?: number
  name: string
  category: DeveloperCategory
  openedAt: string
  validDays: number
  volumeMl: number
  schemaRev?: number
}

export function stockExpireDate(stock: Pick<StockSolution, 'openedAt' | 'validDays'>): string {
  const opened = new Date(`${stock.openedAt}T00:00:00`)
  if (Number.isNaN(opened.getTime()) || !Number.isFinite(stock.validDays)) return ''
  const expire = new Date(opened)
  expire.setDate(expire.getDate() + stock.validDays)
  return expire.toISOString().slice(0, 10)
}

export function isStockExpired(
  stock: Pick<StockSolution, 'openedAt' | 'validDays'>,
  today: Date = new Date()
): boolean {
  const expire = stockExpireDate(stock)
  if (!expire) return false
  return expire < today.toISOString().slice(0, 10)
}
