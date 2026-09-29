import type { DeveloperCategory, Dilution } from './developer'

export type MixStatus = '有效' | '已撤销'

export interface MixRecord {
  id?: number
  mixedAt: string
  stockSolutionId: number
  /** 配制时母液名称快照，母液改名或删除后台账仍可读 */
  stockName: string
  category: DeveloperCategory
  dilution: Dilution
  targetVolumeMl: number
  stockUsedMl: number
  developerId: number
  status: MixStatus
  revokedAt?: string | null
  schemaRev?: number
}
