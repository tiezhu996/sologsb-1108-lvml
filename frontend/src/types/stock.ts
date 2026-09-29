import type { DeveloperCategory } from './developer'

export interface StockSolution {
  id?: number
  name: string
  category: DeveloperCategory
  openedAt: string
  expireDate: string
  initialVolumeMl: number
  remainingMl: number
  note?: string
  schemaRev?: number
}
