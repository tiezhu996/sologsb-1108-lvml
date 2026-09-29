<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StatBadge from '../components/common/StatBadge.vue'
import { useDeveloperStore } from '../stores/developerStore'
import { useStockStore } from '../stores/stockStore'
import { usePreparationStore } from '../stores/preparationStore'
import { useRecipeStore } from '../stores/recipeStore'
import { useRunStore } from '../stores/runStore'
import type { Developer, DeveloperCategory, Dilution } from '../types/developer'
import type { StockSolution } from '../types/stock'
import { isStockExpired, stockExpireDate } from '../types/stock'
import { calculateStockVolume, remainingRolls } from '../utils/ratio'

type TabKey = 'developers' | 'stocks' | 'records'

interface PrepareForm {
  stockId: number | undefined
  category: DeveloperCategory
  dilution: Dilution
  targetVolumeMl: number
  name: string
  mixedAt: string
  maxRolls: number
}

interface StockForm {
  name: string
  category: DeveloperCategory
  openedAt: string
  validDays: number
  volumeMl: number
}

const developerStore = useDeveloperStore()
const stockStore = useStockStore()
const preparationStore = usePreparationStore()
const recipeStore = useRecipeStore()
const runStore = useRunStore()

const tab = ref<TabKey>('developers')
const showPrepare = ref(false)
const showStockForm = ref(false)
const saving = ref(false)

const today = new Date().toISOString().slice(0, 10)

const prepareForm = reactive<PrepareForm>({
  stockId: undefined,
  category: 'D-76',
  dilution: '1:1',
  targetVolumeMl: 1000,
  name: '',
  mixedAt: today,
  maxRolls: 12
})

const stockForm = reactive<StockForm>({
  name: '',
  category: 'D-76',
  openedAt: today,
  validDays: 180,
  volumeMl: 500
})

const categoryStocks = computed(() =>
  stockStore.stocks.filter((stock) => stock.category === prepareForm.category)
)

const selectedStock = computed(() =>
  stockStore.stocks.find((stock) => stock.id === prepareForm.stockId)
)

const stockNeeded = computed(() =>
  calculateStockVolume(prepareForm.targetVolumeMl, prepareForm.dilution)
)

const prepareError = computed<string | null>(() => {
  if (!selectedStock.value) return '请选择母液'
  const expire = stockExpireDate(selectedStock.value)
  if (expire && expire < prepareForm.mixedAt) {
    return `母液已过期（有效期至 ${expire}），不能配制`
  }
  if (selectedStock.value.volumeMl < stockNeeded.value) {
    return `母液余量不足：配制需 ${stockNeeded.value} mL，当前仅余 ${selectedStock.value.volumeMl} mL`
  }
  return null
})

const rinsedDeveloperIds = computed(() => {
  const ids = new Set<number>()
  for (const run of runStore.runs) {
    const recipe = recipeStore.recipes.find((item) => item.id === run.recipeId)
    if (recipe) ids.add(recipe.developerId)
  }
  return ids
})

const activeDevelopers = computed(() =>
  developerStore.developers.filter((developer) => developer.state !== '报废')
)

const expiredStockCount = computed(() =>
  stockStore.stocks.filter((stock) => isStockExpired(stock)).length
)

const totalStockVolume = computed(() =>
  stockStore.stocks.reduce((sum, stock) => sum + stock.volumeMl, 0)
)

const activeRecordCount = computed(() =>
  preparationStore.records.filter((record) => record.state === '正常').length
)

const revokedRecordCount = computed(() =>
  preparationStore.records.filter((record) => record.state === '已撤销').length
)

const totalStockUsed = computed(() =>
  preparationStore.records
    .filter((record) => record.state === '正常')
    .reduce((sum, record) => sum + record.stockUsedMl, 0)
)

watch(() => prepareForm.category, () => {
  const first = categoryStocks.value.find((stock) => !isStockExpired(stock) && stock.volumeMl > 0)
  prepareForm.stockId = first?.id
})

watch(() => prepareForm.stockId, (stockId) => {
  const stock = stockStore.stocks.find((item) => item.id === stockId)
  if (stock && !prepareForm.name.trim()) {
    prepareForm.name = `${stock.name} ${prepareForm.dilution} 工作液`
  }
})

function stateTone(developer: Developer): 'cyan' | 'amber' | 'rose' {
  if (developer.state === '报废') return 'rose'
  if (developer.state === '新配') return 'cyan'
  return 'amber'
}

function stockForDeveloper(developer: Developer): StockSolution | undefined {
  if (developer.stockId === undefined) return undefined
  return stockStore.stocks.find((stock) => stock.id === developer.stockId)
}

function stockName(stockId: number): string {
  const stock = stockStore.stocks.find((item) => item.id === stockId)
  return stock ? stock.name : '已删除母液'
}

function developerName(developerId: number): string {
  const developer = developerStore.developers.find((item) => item.id === developerId)
  return developer ? developer.name : `工作液 #${developerId}（已撤销）`
}

function stockTone(stock: StockSolution): 'cyan' | 'amber' | 'rose' {
  if (isStockExpired(stock)) return 'rose'
  if (stock.volumeMl === 0) return 'amber'
  return 'cyan'
}

function stockStatus(stock: StockSolution): string {
  if (isStockExpired(stock)) return '已过期'
  if (stock.volumeMl === 0) return '余量耗尽'
  return '可用'
}

async function submitPrepare(): Promise<void> {
  if (!selectedStock.value || !prepareForm.name.trim() || !prepareForm.mixedAt) {
    ElMessage.warning('请填写工作液名称、配制日期并选择母液')
    return
  }
  if (prepareError.value) {
    ElMessage.error(prepareError.value)
    return
  }
  saving.value = true
  try {
    await preparationStore.prepareWorkingSolution({
      stockId: prepareForm.stockId as number,
      name: prepareForm.name.trim(),
      category: prepareForm.category,
      dilution: prepareForm.dilution,
      targetVolumeMl: Math.max(1, prepareForm.targetVolumeMl),
      mixedAt: prepareForm.mixedAt,
      maxRolls: Math.max(1, prepareForm.maxRolls)
    })
    ElMessage.success('工作液已配制，母液余量已扣减')
    prepareForm.name = ''
    prepareForm.targetVolumeMl = 1000
    prepareForm.maxRolls = 12
    showPrepare.value = false
    await Promise.all([developerStore.load(), stockStore.load(), preparationStore.load()])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配制失败')
  } finally {
    saving.value = false
  }
}

async function submitStock(): Promise<void> {
  if (!stockForm.name.trim() || !stockForm.openedAt) {
    ElMessage.warning('请填写母液名称与开封日期')
    return
  }
  saving.value = true
  try {
    await stockStore.addStock({
      name: stockForm.name.trim(),
      category: stockForm.category,
      openedAt: stockForm.openedAt,
      validDays: Math.max(1, stockForm.validDays),
      volumeMl: Math.max(0, stockForm.volumeMl)
    })
    ElMessage.success('母液已登记入账')
    stockForm.name = ''
    stockForm.volumeMl = 500
    showStockForm.value = false
  } finally {
    saving.value = false
  }
}

async function scrapDeveloper(id?: number): Promise<void> {
  if (id === undefined) return
  await developerStore.scrap(id)
  ElMessage.success('该工作液已标记为报废')
}

async function revokeRecord(recordId: number): Promise<void> {
  saving.value = true
  try {
    await preparationStore.revokePreparation(recordId)
    ElMessage.success('配制已撤销，母液余量已恢复')
    await Promise.all([developerStore.load(), stockStore.load(), preparationStore.load()])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤销失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    developerStore.load(),
    stockStore.load(),
    preparationStore.load(),
    recipeStore.load(),
    runStore.load()
  ])
  const first = categoryStocks.value.find((stock) => !isStockExpired(stock) && stock.volumeMl > 0)
  if (first) prepareForm.stockId = first.id
})
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--compact">
      <div>
        <span class="eyebrow">CHEMISTRY DESK</span>
        <h1>显影液配制与余量</h1>
        <p>母液分装登记、工作液配制与来源追溯一本台账。配制时按稀释比扣减母液，过期、余量不足或类别不符均不写入。</p>
      </div>
      <button type="button" class="primary-button" data-testid="new-developer" @click="tab = 'developers'; showPrepare = !showPrepare">
        {{ showPrepare ? '收起配制表单' : '配制工作液' }}
      </button>
    </header>

    <div class="tab-bar">
      <button
        type="button"
        class="tab-button"
        :class="{ 'tab-button--active': tab === 'developers' }"
        data-testid="tab-developers"
        @click="tab = 'developers'"
      >工作液</button>
      <button
        type="button"
        class="tab-button"
        :class="{ 'tab-button--active': tab === 'stocks' }"
        data-testid="tab-stocks"
        @click="tab = 'stocks'"
      >母液</button>
      <button
        type="button"
        class="tab-button"
        :class="{ 'tab-button--active': tab === 'records' }"
        data-testid="tab-records"
        @click="tab = 'records'"
      >配制记录</button>
    </div>

    <!-- 工作液 -->
    <template v-if="tab === 'developers'">
      <div class="stat-strip">
        <StatBadge label="工作液总数" :value="developerStore.developers.length" hint="含新配与报废记录" tone="cyan" />
        <StatBadge label="可用余量" :value="developerStore.availableRolls" hint="按剩余可冲卷数合计" tone="amber" />
        <StatBadge label="已报废" :value="developerStore.developers.filter((item) => item.state === '报废').length" hint="不再计入可用余量" tone="rose" />
      </div>

      <form v-if="showPrepare" class="inline-form" data-testid="form-prepare" @submit.prevent="submitPrepare">
        <div class="inline-form__head">
          <div>
            <h2>由母液配制工作液</h2>
            <p>选择母液与稀释比，按目标容量换算母液用量并扣减，同时生成工作液与配制记录。</p>
          </div>
        </div>
        <div class="form-grid form-grid--three">
          <label>
            <span>工作液类别</span>
            <select v-model="prepareForm.category" data-testid="field-prepare-category">
              <option value="D-76">D-76</option>
              <option value="HC-110">HC-110</option>
              <option value="Rodinal">Rodinal</option>
              <option value="C-41">C-41</option>
            </select>
          </label>
          <label>
            <span>母液</span>
            <select v-model="prepareForm.stockId" data-testid="field-prepare-stock">
              <option v-for="stock in categoryStocks" :key="stock.id" :value="stock.id" :disabled="isStockExpired(stock) || stock.volumeMl === 0">
                {{ stock.name }} · 余 {{ stock.volumeMl }} mL · {{ isStockExpired(stock) ? '已过期' : `有效期至 ${stockExpireDate(stock)}` }}
              </option>
            </select>
          </label>
          <label>
            <span>稀释比</span>
            <select v-model="prepareForm.dilution" data-testid="field-prepare-dilution">
              <option value="1:1">1:1</option>
              <option value="1:3">1:3</option>
            </select>
          </label>
          <label>
            <span>目标容量（工作液总量）</span>
            <input v-model.number="prepareForm.targetVolumeMl" data-testid="field-prepare-targetVolumeMl" type="number" min="1" step="50" />
          </label>
          <label>
            <span>工作液名称</span>
            <input v-model="prepareForm.name" data-testid="field-prepare-name" type="text" placeholder="默认按母液与稀释比生成" />
          </label>
          <label>
            <span>配制日期</span>
            <input v-model="prepareForm.mixedAt" data-testid="field-prepare-mixedAt" type="date" />
          </label>
          <label>
            <span>可冲上限</span>
            <input v-model.number="prepareForm.maxRolls" data-testid="field-prepare-maxRolls" type="number" min="1" max="100" />
          </label>
          <div class="span-2 prepare-result">
            <div>
              <strong>{{ prepareForm.targetVolumeMl }} mL</strong>
              <span>需母液 {{ stockNeeded }} mL · 母液余量 {{ selectedStock?.volumeMl ?? 0 }} mL</span>
            </div>
            <span v-if="prepareError" class="prepare-result__error">{{ prepareError }}</span>
            <span v-else class="prepare-result__ok">校验通过，配制后将扣减母液 {{ stockNeeded }} mL</span>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="ghost-button" @click="showPrepare = false">取消</button>
          <button type="submit" class="primary-button" data-testid="submit-prepare" :disabled="saving || !!prepareError">
            {{ saving ? '配制中…' : '确认配制' }}
          </button>
        </div>
      </form>

      <div class="dev-grid">
        <div class="panel dev-count-panel">
          <span>台账记录</span>
          <strong data-testid="count-developer">{{ developerStore.developers.length }}</strong>
          <small>条工作液记录</small>
        </div>
        <article
          v-for="developer in developerStore.developers"
          :key="developer.id"
          class="entity-card developer-card"
          data-testid="row-developer"
        >
          <div class="entity-card__main">
            <div class="entity-card__title">
              <div>
                <span class="status-chip" :class="`status--${stateTone(developer)}`">{{ developer.state }}</span>
                <h2>{{ developer.name }}</h2>
                <p v-if="stockForDeveloper(developer)" class="source-line">
                  来源：<strong>{{ stockForDeveloper(developer)?.name }}</strong>
                  <span class="status-chip status--cyan">母液分装</span>
                </p>
                <p v-else class="source-line">
                  <span class="status-chip status--slate">来源未追溯</span>
                  <small>升级前登记的工作液，照常可用，未补造母液</small>
                </p>
              </div>
              <button
                v-if="developer.state !== '报废'"
                type="button"
                class="text-button text-button--danger"
                @click="scrapDeveloper(developer.id)"
              >
                标记报废
              </button>
            </div>
            <dl class="data-pairs">
              <div><dt>类型 / 稀释</dt><dd>{{ developer.category }} · {{ developer.dilution }}</dd></div>
              <div><dt>工作液容量</dt><dd>{{ developer.volumeMl }} mL</dd></div>
              <div><dt>配制日期</dt><dd>{{ developer.mixedAt }}</dd></div>
              <div><dt>所需浓缩液</dt><dd>{{ calculateStockVolume(developer.volumeMl, developer.dilution) }} mL</dd></div>
            </dl>
            <div class="life-meter">
              <div class="life-meter__head">
                <span>剩余 {{ remainingRolls(developer.maxRolls, developer.usedRolls) }} 卷</span>
                <span>已用 {{ developer.usedRolls }} / {{ developer.maxRolls }}</span>
              </div>
              <div class="life-meter__track">
                <i :style="{ width: `${Math.min(100, developer.usedRolls / developer.maxRolls * 100)}%` }"></i>
              </div>
              <small v-if="remainingRolls(developer.maxRolls, developer.usedRolls) === 0">余量已耗尽，建议报废并重新配制。</small>
            </div>
          </div>
        </article>
      </div>
    </template>

    <!-- 母液 -->
    <template v-if="tab === 'stocks'">
      <div class="stat-strip">
        <StatBadge label="母液种类" :value="stockStore.stocks.length" hint="登记在册的分装母液" tone="cyan" />
        <StatBadge label="可用母液" :value="stockStore.activeStocks.length" hint="余量大于 0 且未过期" tone="amber" />
        <StatBadge label="已过期" :value="expiredStockCount" hint="过期母液不能配制" tone="rose" />
        <StatBadge label="母液总余量" :value="totalStockVolume" hint="mL" tone="slate" />
      </div>

      <div class="panel stock-toolbar">
        <div>
          <h2>母液分装台账</h2>
          <p>登记每次分装的母液类别、开封日、有效期与余量，配制工作液时按稀释比扣减。</p>
        </div>
        <button type="button" class="primary-button" data-testid="new-stock" @click="showStockForm = !showStockForm">
          {{ showStockForm ? '收起表单' : '登记母液' }}
        </button>
      </div>

      <form v-if="showStockForm" class="inline-form" data-testid="form-stock" @submit.prevent="submitStock">
        <div class="form-grid form-grid--three">
          <label>
            <span>母液名称</span>
            <input v-model="stockForm.name" data-testid="field-stock-name" type="text" placeholder="如 柯达 D-76 浓缩液" />
          </label>
          <label>
            <span>类别</span>
            <select v-model="stockForm.category" data-testid="field-stock-category">
              <option value="D-76">D-76</option>
              <option value="HC-110">HC-110</option>
              <option value="Rodinal">Rodinal</option>
              <option value="C-41">C-41</option>
            </select>
          </label>
          <label>
            <span>开封日期</span>
            <input v-model="stockForm.openedAt" data-testid="field-stock-openedAt" type="date" />
          </label>
          <label>
            <span>有效期（开封后天数）</span>
            <input v-model.number="stockForm.validDays" data-testid="field-stock-validDays" type="number" min="1" max="3650" />
          </label>
          <label>
            <span>余量（mL）</span>
            <input v-model.number="stockForm.volumeMl" data-testid="field-stock-volumeMl" type="number" min="0" step="50" />
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="ghost-button" @click="showStockForm = false">取消</button>
          <button type="submit" class="primary-button" data-testid="submit-stock" :disabled="saving">
            {{ saving ? '保存中…' : '保存母液' }}
          </button>
        </div>
      </form>

      <div class="dev-grid">
        <article
          v-for="stock in stockStore.stocks"
          :key="stock.id"
          class="entity-card stock-card"
          data-testid="row-stock"
        >
          <div class="entity-card__main">
            <div class="entity-card__title">
              <div>
                <span class="status-chip" :class="`status--${stockTone(stock)}`">{{ stockStatus(stock) }}</span>
                <h2>{{ stock.name }}</h2>
                <p>{{ stock.category }} · 开封于 {{ stock.openedAt }}</p>
              </div>
            </div>
            <dl class="data-pairs">
              <div><dt>类别</dt><dd>{{ stock.category }}</dd></div>
              <div><dt>开封日</dt><dd>{{ stock.openedAt }}</dd></div>
              <div><dt>有效期至</dt><dd>{{ stockExpireDate(stock) }}</dd></div>
              <div><dt>当前余量</dt><dd>{{ stock.volumeMl }} mL</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </template>

    <!-- 配制记录 -->
    <template v-if="tab === 'records'">
      <div class="stat-strip">
        <StatBadge label="配制记录" :value="preparationStore.records.length" hint="本台账全部配制条目" tone="cyan" />
        <StatBadge label="正常" :value="activeRecordCount" hint="已生成工作液并扣减母液" tone="amber" />
        <StatBadge label="已撤销" :value="revokedRecordCount" hint="母液余量已恢复，记录留档" tone="slate" />
        <StatBadge label="累计消耗母液" :value="totalStockUsed" hint="仅统计正常记录（mL）" tone="rose" />
      </div>

      <div class="panel">
        <div class="panel__head">
          <div>
            <h2>配制台账</h2>
            <p>每条记录连接母液与工作液。未冲洗的配制可撤销，撤销后恢复母液余量，记录保留为已撤销；已冲洗的工作液不能撤销。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>母液</th>
                <th>工作液</th>
                <th>类别 / 稀释</th>
                <th>目标容量</th>
                <th>消耗母液</th>
                <th>配制日期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in preparationStore.records" :key="record.id" data-testid="row-preparation">
                <td>
                  <strong>{{ stockName(record.stockId) }}</strong>
                  <small>母液 #{{ record.stockId }}</small>
                </td>
                <td>
                  <strong>{{ developerName(record.developerId) }}</strong>
                  <small v-if="rinsedDeveloperIds.has(record.developerId)" class="text-danger">已用于冲洗</small>
                </td>
                <td>{{ record.category }} · {{ record.dilution }}</td>
                <td>{{ record.targetVolumeMl }} mL</td>
                <td>{{ record.stockUsedMl }} mL</td>
                <td>{{ record.preparedAt }}</td>
                <td>
                  <span v-if="record.state === '正常'" class="status-chip status--cyan">正常</span>
                  <span v-else class="status-chip status--slate">已撤销</span>
                  <small v-if="record.revokedAt">撤销于 {{ record.revokedAt }}</small>
                </td>
                <td>
                  <button
                    v-if="record.state === '正常'"
                    type="button"
                    class="text-button text-button--danger"
                    :data-testid="`button-revoke-${record.id}`"
                    :disabled="saving"
                    @click="revokeRecord(record.id as number)"
                  >撤销配制</button>
                  <span v-else class="record-voided">已撤销</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="preparationStore.records.length === 0" class="inline-empty">暂无配制记录，在「工作液」页签配制一次后生成台账。</div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tab-bar {
  display: flex;
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: rgba(255, 253, 248, 0.9);
  box-shadow: 0 8px 24px rgba(77, 56, 35, 0.05);
}

.tab-button {
  flex: 1;
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--ink-soft);
  background: transparent;
  cursor: pointer;
}

.tab-button--active {
  border-color: var(--line-strong);
  color: var(--accent-deep);
  background: #f7eee2;
  font-weight: 700;
}

.stock-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.stock-toolbar h2 {
  margin: 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: 18px;
}

.stock-toolbar p {
  margin: 4px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
}

.prepare-result {
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  padding: 9px 12px;
  border: 1px solid rgba(41, 127, 137, 0.2);
  border-radius: 10px;
  color: #285f66;
  background: #eef8f7;
}

.prepare-result strong {
  font-size: 18px;
}

.prepare-result span {
  color: #52777b;
  font-size: 12px;
}

.prepare-result__error {
  color: var(--danger) !important;
  font-weight: 600;
}

.source-line {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  margin: 3px 0 0 !important;
  color: var(--ink-soft);
  font-size: 12px;
}

.source-line small {
  color: var(--ink-soft);
  font-size: 11px;
}

.status--slate {
  color: #5c6470;
  background: #e9ebef;
}

.record-voided {
  color: var(--ink-soft);
  font-size: 12px;
}

@media (max-width: 650px) {
  .stock-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
