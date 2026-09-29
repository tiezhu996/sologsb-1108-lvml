export type DeveloperCategory = 'D-76' | 'HC-110' | 'Rodinal' | 'C-41'
export type Dilution = '1:1' | '1:3'
export type DeveloperState = '新配' | '在用' | '报废' | '已撤销'
export type DeveloperSource = 'ledger' | 'legacy'

export interface Developer {
  id?: number
  name: string
  category: DeveloperCategory
  dilution: Dilution
  volumeMl: number
  mixedAt: string
  maxRolls: number
  usedRolls: number
  state: DeveloperState
  /** ledger：由母液台账配制生成；legacy：升级前的旧工作液，来源未追溯 */
  source: DeveloperSource
  stockSolutionId?: number | null
  mixRecordId?: number | null
  schemaRev?: number
}
