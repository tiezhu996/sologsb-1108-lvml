import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { StockSolution } from '../types/stock'

type NewStock = Omit<StockSolution, 'id' | 'schemaRev'>

export const useStockStore = defineStore('stock', {
  state: () => ({
    stocks: [] as StockSolution[],
    loading: false
  }),
  getters: {
    activeStocks: (state) => state.stocks.filter((stock) => stock.volumeMl > 0)
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
    async addStock(payload: NewStock): Promise<number> {
      const id = await db.stockSolutions.add(plain({ ...payload, schemaRev: 3 }))
      await this.load()
      return id
    }
  }
})
