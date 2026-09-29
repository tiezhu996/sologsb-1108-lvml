import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { Developer, DeveloperCategory, Dilution } from '../types/developer'
import type { MixRecord } from '../types/mix-record'
import { calculateStockVolume, estimateRolls, isDeveloperTerminal } from '../utils/ratio'
import { checkStockForMix } from '../utils/stock'

export interface MixPayload {
  name: string
  stockSolutionId: number
  category: DeveloperCategory
  dilution: Dilution
  targetVolumeMl: number
  mixedAt: string
}

export const useDeveloperStore = defineStore('developer', {
  state: () => ({
    developers: [] as Developer[],
    mixRecords: [] as MixRecord[],
    loading: false
  }),
  getters: {
    activeDevelopers: (state) => state.developers.filter((developer) => !isDeveloperTerminal(developer.state)),
    availableRolls(): number {
      return this.activeDevelopers.reduce(
        (sum, developer) =>
          sum + Math.max(0, developer.maxRolls - developer.usedRolls),
        0
      )
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        const [developers, mixRecords] = await Promise.all([
          db.developers.orderBy('id').reverse().toArray(),
          db.mixRecords.orderBy('id').reverse().toArray()
        ])
        this.developers = developers
        this.mixRecords = mixRecords
      } finally {
        this.loading = false
      }
    },
    /**
     * 用母液调工作液：
     * 校验母液未过期、余量足够、类别相符；同一事务内扣减母液余量，
     * 生成工作液与配制记录。任一步失败整笔回滚，不产生半条台账。
     */
    async mixWorkingSolution(payload: MixPayload): Promise<number> {
      const targetVolumeMl = Math.max(0, Math.round(payload.targetVolumeMl))
      const requiredMl = calculateStockVolume(targetVolumeMl, payload.dilution)
      const stock = await db.stockSolutions.get(payload.stockSolutionId)
      const check = checkStockForMix(stock, requiredMl, payload.category)
      if (check.code !== 'ok' || !stock || stock.id === undefined) {
        throw new Error(check.message || '母液校验未通过')
      }
      const stockId = stock.id
      const developerId = await db.transaction('rw', db.stockSolutions, db.developers, db.mixRecords, async () => {
        const current = await db.stockSolutions.get(stockId)
        const recheck = checkStockForMix(current, requiredMl, payload.category)
        if (recheck.code !== 'ok' || !current) {
          throw new Error(recheck.message || '母液校验未通过')
        }
        const nextRemaining = current.remainingMl - requiredMl
        await db.stockSolutions.update(stockId, plain({ remainingMl: nextRemaining }))

        const newDeveloperId = await db.developers.add(plain({
          name: payload.name.trim(),
          category: payload.category,
          dilution: payload.dilution,
          volumeMl: targetVolumeMl,
          mixedAt: payload.mixedAt,
          maxRolls: Math.max(1, estimateRolls(targetVolumeMl)),
          usedRolls: 0,
          state: '新配',
          source: 'ledger',
          stockSolutionId: stockId,
          mixRecordId: null,
          schemaRev: 3
        } satisfies Developer))

        const mixRecordId = await db.mixRecords.add(plain({
          mixedAt: payload.mixedAt,
          stockSolutionId: stockId,
          stockName: current.name,
          category: payload.category,
          dilution: payload.dilution,
          targetVolumeMl,
          stockUsedMl: requiredMl,
          developerId: newDeveloperId as number,
          status: '有效',
          revokedAt: null,
          schemaRev: 3
        } satisfies MixRecord))

        await db.developers.update(newDeveloperId as number, plain({ mixRecordId: mixRecordId as number }))

        return newDeveloperId as number
      })
      await this.load()
      return developerId
    },
    /**
     * 撤销未冲洗的工作液：恢复母液余量，工作液与配制记录均标记“已撤销”并留痕。
     * 已冲洗（usedRolls > 0）、已报废或已撤销的工作液不能撤销。
     */
    async revokeWorkingSolution(developerId: number): Promise<void> {
      await db.transaction('rw', db.stockSolutions, db.developers, db.mixRecords, async () => {
        const developer = await db.developers.get(developerId)
        if (!developer) throw new Error('工作液不存在，无法撤销')
        if (isDeveloperTerminal(developer.state)) throw new Error('该工作液已终态，不能撤销')
        if (developer.usedRolls > 0) throw new Error('该工作液已用于冲洗，不能撤销')
        if (developer.source !== 'ledger' || developer.stockSolutionId == null || developer.mixRecordId == null) {
          throw new Error('该工作液来源未追溯，不能撤销')
        }
        const record = await db.mixRecords.get(developer.mixRecordId)
        if (!record || record.status !== '有效') throw new Error('配制记录状态异常，不能撤销')
        const stock = await db.stockSolutions.get(developer.stockSolutionId)
        if (!stock) throw new Error('对应母液已不存在，无法恢复余量')

        const restoredMl = Math.min(stock.remainingMl + record.stockUsedMl, stock.initialVolumeMl)
        await db.stockSolutions.update(stock.id as number, plain({ remainingMl: restoredMl }))
        await db.developers.update(developerId, plain({ state: '已撤销' }))
        await db.mixRecords.update(record.id as number, plain({
          status: '已撤销',
          revokedAt: new Date().toISOString().slice(0, 10)
        }))
      })
      await this.load()
    },
    async scrap(id: number): Promise<void> {
      const developer = await db.developers.get(id)
      if (!developer) return
      if (developer.state === '已撤销') throw new Error('已撤销的工作液不能标记报废')
      await db.developers.update(id, plain({ state: '报废' }))
      await this.load()
    }
  }
})
