import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { StockSolution } from '../types/stock'
import type { DeveloperCategory } from '../types/developer'

type NewStock = Omit<StockSolution, 'id' | 'schemaRev' | 'remainingMl'> & {
  initialVolumeMl: number
}

export const useStockStore = defineStore('stock', {
  state: () => ({
    stocks: [] as StockSolution[],
    loading: false
  }),
  getters: {
    validStocks: (state) => [...state.stocks]
      .filter((stock) => stock.expireDate >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.expireDate.localeCompare(b.expireDate)),
    totalRemainingMl: (state) => state.stocks.reduce((sum, stock) => sum + stock.remainingMl, 0)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.stocks = await db.stockSolutions.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    stocksOfCategory(category: DeveloperCategory): StockSolution[] {
      return this.validStocks.filter((stock) => stock.category === category)
    },
    async addStock(payload: NewStock): Promise<number> {
      const next: StockSolution = {
        ...payload,
        initialVolumeMl: Math.max(0, payload.initialVolumeMl),
        remainingMl: Math.max(0, payload.initialVolumeMl),
        schemaRev: 3
      }
      const id = await db.stockSolutions.add(plain(next))
      await this.load()
      return id
    }
  }
})
