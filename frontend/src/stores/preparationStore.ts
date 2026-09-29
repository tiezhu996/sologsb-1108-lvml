import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import { calculateStockVolume } from '../utils/ratio'
import { stockExpireDate } from '../types/stock'
import type { PreparationRecord } from '../types/preparation'
import type { Developer } from '../types/developer'
import type { DeveloperCategory, Dilution } from '../types/developer'

export interface PreparePayload {
  stockId: number
  name: string
  category: DeveloperCategory
  dilution: Dilution
  targetVolumeMl: number
  mixedAt: string
  maxRolls: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export const usePreparationStore = defineStore('preparation', {
  state: () => ({
    records: [] as PreparationRecord[],
    loading: false
  }),
  getters: {
    activeRecords: (state) => state.records.filter((record) => record.state === '正常')
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.records = await db.preparationRecords.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    async prepareWorkingSolution(payload: PreparePayload): Promise<number> {
      const stock = await db.stockSolutions.get(payload.stockId)
      if (!stock || stock.id === undefined) {
        throw new Error('母液不存在，请重新选择')
      }
      if (stock.category !== payload.category) {
        throw new Error('母液类别与工作液类别不符，不能配制')
      }
      const expire = stockExpireDate(stock)
      if (expire && expire < payload.mixedAt) {
        throw new Error(`母液已过期（有效期至 ${expire}），不能用于配制`)
      }
      const stockNeeded = calculateStockVolume(payload.targetVolumeMl, payload.dilution)
      if (stock.volumeMl < stockNeeded) {
        throw new Error(`母液余量不足：配制需 ${stockNeeded} mL，当前仅余 ${stock.volumeMl} mL`)
      }

      const developer: Developer = {
        name: payload.name.trim(),
        category: payload.category,
        dilution: payload.dilution,
        volumeMl: payload.targetVolumeMl,
        mixedAt: payload.mixedAt,
        maxRolls: Math.max(1, payload.maxRolls),
        usedRolls: 0,
        state: '新配',
        stockId: stock.id,
        schemaRev: 3
      }

      return db.transaction('rw', db.stockSolutions, db.developers, db.preparationRecords, async () => {
        const developerId = await db.developers.add(plain(developer))
        await db.stockSolutions.update(stock.id as number, plain({ volumeMl: stock.volumeMl - stockNeeded }))
        const recordId = await db.preparationRecords.add(plain({
          stockId: stock.id as number,
          developerId,
          category: payload.category,
          dilution: payload.dilution,
          targetVolumeMl: payload.targetVolumeMl,
          stockUsedMl: stockNeeded,
          preparedAt: payload.mixedAt,
          state: '正常',
          schemaRev: 3
        }))
        await this.load()
        return recordId
      })
    },
    async revokePreparation(recordId: number): Promise<void> {
      const record = await db.preparationRecords.get(recordId)
      if (!record || record.state !== '正常') return

      const developer = await db.developers.get(record.developerId)
      if (developer && developer.id !== undefined) {
        const recipes = await db.recipes.where('developerId').equals(developer.id).toArray()
        for (const recipe of recipes) {
          if (recipe.id === undefined) continue
          const runCount = await db.runs.where('recipeId').equals(recipe.id).count()
          if (runCount > 0) {
            throw new Error('该工作液已用于冲洗，不能撤销')
          }
        }
      }

      await db.transaction('rw', db.stockSolutions, db.developers, db.preparationRecords, async () => {
        const stock = await db.stockSolutions.get(record.stockId)
        if (stock && stock.id !== undefined) {
          await db.stockSolutions.update(stock.id, plain({ volumeMl: stock.volumeMl + record.stockUsedMl }))
        }
        await db.developers.delete(record.developerId)
        await db.preparationRecords.update(recordId, plain({ state: '已撤销', revokedAt: today() }))
      })
      await this.load()
    }
  }
})
