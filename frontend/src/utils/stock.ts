import type { DeveloperCategory } from '../types/developer'
import type { StockSolution } from '../types/stock'

export type StockCheckCode = 'ok' | 'missing' | 'expired' | 'insufficient' | 'categoryMismatch'

export interface StockCheckResult {
  code: StockCheckCode
  message: string
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isStockExpired(stock: StockSolution, today = todayString()): boolean {
  return Boolean(stock.expireDate) && stock.expireDate < today
}

/**
 * 配制前校验母液：不存在、已过期、余量不足或类别不符均拒绝写入。
 * expectedCategory 省略时不校验类别。
 */
export function checkStockForMix(
  stock: StockSolution | undefined,
  requiredMl: number,
  expectedCategory?: DeveloperCategory
): StockCheckResult {
  if (!stock) {
    return { code: 'missing', message: '所选母液不存在，请重新选择' }
  }
  if (isStockExpired(stock)) {
    return { code: 'expired', message: `母液「${stock.name}」已于 ${stock.expireDate} 过期，不能用于配制` }
  }
  if (expectedCategory && stock.category !== expectedCategory) {
    return { code: 'categoryMismatch', message: `母液「${stock.name}」类别为 ${stock.category}，与所选类别不符` }
  }
  if (!(requiredMl > 0)) {
    return { code: 'insufficient', message: '目标容量或稀释比无效，换算不出母液用量' }
  }
  if (stock.remainingMl < requiredMl) {
    return {
      code: 'insufficient',
      message: `母液「${stock.name}」余量 ${stock.remainingMl} mL，不足本次所需 ${requiredMl} mL`
    }
  }
  return { code: 'ok', message: '' }
}
