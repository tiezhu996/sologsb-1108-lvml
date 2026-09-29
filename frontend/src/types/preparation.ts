import type { DeveloperCategory, Dilution } from './developer'

export type PreparationState = '正常' | '已撤销'

export interface PreparationRecord {
  id?: number
  stockId: number
  developerId: number
  category: DeveloperCategory
  dilution: Dilution
  targetVolumeMl: number
  stockUsedMl: number
  preparedAt: string
  state: PreparationState
  revokedAt?: string
  schemaRev?: number
}
