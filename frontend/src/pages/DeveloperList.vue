<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DilutionInput from '../components/common/DilutionInput.vue'
import EmptyPanel from '../components/common/EmptyPanel.vue'
import StatBadge from '../components/common/StatBadge.vue'
import { useDeveloperStore } from '../stores/developerStore'
import { useStockStore } from '../stores/stockStore'
import type { Developer, DeveloperCategory, Dilution } from '../types/developer'
import type { StockSolution } from '../types/stock'
import { calculateStockVolume, estimateRolls, isDeveloperTerminal, remainingRolls } from '../utils/ratio'
import { checkStockForMix, isStockExpired, todayString } from '../utils/stock'

interface StockForm {
  name: string
  category: DeveloperCategory
  openedAt: string
  expireDate: string
  initialVolumeMl: number
  note: string
}

interface MixForm {
  stockSolutionId: number | null
  dilution: Dilution
  targetVolumeMl: number
  mixedAt: string
  name: string
}

const developerStore = useDeveloperStore()
const stockStore = useStockStore()
const today = todayString()

const showStockForm = ref(false)
const showMixForm = ref(false)
const savingStock = ref(false)
const savingMix = ref(false)

const stockForm = reactive<StockForm>({
  name: '',
  category: 'D-76',
  openedAt: today,
  expireDate: '',
  initialVolumeMl: 1000,
  note: ''
})

const mixForm = reactive<MixForm>({
  stockSolutionId: null,
  dilution: '1:1',
  targetVolumeMl: 1000,
  mixedAt: today,
  name: ''
})

const categories: DeveloperCategory[] = ['D-76', 'HC-110', 'Rodinal', 'C-41']

const selectedStock = computed<StockSolution | undefined>(() =>
  stockStore.stocks.find((stock) => stock.id === mixForm.stockSolutionId)
)
const mixCategory = computed<DeveloperCategory | undefined>(() => selectedStock.value?.category)
const requiredMl = computed(() => calculateStockVolume(mixForm.targetVolumeMl, mixForm.dilution))
const mixCheck = computed(() => checkStockForMix(selectedStock.value, requiredMl.value, mixCategory.value))
const suggestedName = computed(() => {
  const stock = selectedStock.value
  if (!stock) return ''
  return `${stock.name.replace(/母液|浓缩液/g, '').trim() || stock.name} 工作液 ${mixForm.mixedAt}`
})

function stockState(stock: StockSolution): { label: string; tone: 'cyan' | 'amber' | 'rose' } {
  if (isStockExpired(stock)) return { label: '已过期', tone: 'rose' }
  if (stock.remainingMl <= 0) return { label: '余量已尽', tone: 'amber' }
  return { label: '可用', tone: 'cyan' }
}

function stateTone(developer: Developer): 'cyan' | 'amber' | 'rose' {
  if (isDeveloperTerminal(developer.state)) return 'rose'
  if (developer.state === '新配') return 'cyan'
  return 'amber'
}

function stockNameOf(developer: Developer): string {
  if (developer.source === 'legacy') return '来源未追溯（升级前旧工作液）'
  const stock = stockStore.stocks.find((item) => item.id === developer.stockSolutionId)
  return stock ? stock.name : '母液记录已缺失'
}

async function submitStock(): Promise<void> {
  if (!stockForm.name.trim()) {
    ElMessage.warning('请填写母液名称')
    return
  }
  if (!stockForm.openedAt || !stockForm.expireDate) {
    ElMessage.warning('请填写开封日期与有效期')
    return
  }
  if (stockForm.expireDate < stockForm.openedAt) {
    ElMessage.warning('有效期不能早于开封日期')
    return
  }
  if (!(stockForm.initialVolumeMl > 0)) {
    ElMessage.warning('初始容量需大于 0 mL')
    return
  }
  savingStock.value = true
  try {
    await stockStore.addStock({
      name: stockForm.name.trim(),
      category: stockForm.category,
      openedAt: stockForm.openedAt,
      expireDate: stockForm.expireDate,
      initialVolumeMl: Number(stockForm.initialVolumeMl),
      note: stockForm.note.trim()
    })
    ElMessage.success('母液已登记，余量按初始容量入账')
    stockForm.name = ''
    stockForm.initialVolumeMl = 1000
    stockForm.note = ''
    showStockForm.value = false
  } finally {
    savingStock.value = false
  }
}

async function submitMix(): Promise<void> {
  if (mixForm.stockSolutionId === null) {
    ElMessage.warning('请选择一瓶母液')
    return
  }
  if (!(mixForm.targetVolumeMl > 0)) {
    ElMessage.warning('请填写有效的目标容量')
    return
  }
  if (!mixForm.mixedAt) {
    ElMessage.warning('请选择配制日期')
    return
  }
  if (mixCheck.value.code !== 'ok') {
    ElMessage.error(mixCheck.value.message)
    return
  }
  savingMix.value = true
  try {
    await developerStore.mixWorkingSolution({
      name: (mixForm.name.trim() || suggestedName.value),
      stockSolutionId: Number(mixForm.stockSolutionId),
      category: mixCategory.value as DeveloperCategory,
      dilution: mixForm.dilution,
      targetVolumeMl: Number(mixForm.targetVolumeMl),
      mixedAt: mixForm.mixedAt
    })
    ElMessage.success(`工作液已生成，母液扣减 ${requiredMl.value} mL，配制记录已入账`)
    mixForm.stockSolutionId = null
    mixForm.targetVolumeMl = 1000
    mixForm.dilution = '1:1'
    mixForm.name = ''
    showMixForm.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配制失败，未写入台账')
  } finally {
    savingMix.value = false
  }
}

async function revokeDeveloper(developer: Developer): Promise<void> {
  if (developer.id === undefined) return
  try {
    await ElMessageBox.confirm(
      `撤销后将向母液恢复 ${calculateStockVolume(developer.volumeMl, developer.dilution)} mL，工作液标记为已撤销且记录保留。确认撤销？`,
      '撤销未冲洗工作液',
      { confirmButtonText: '确认撤销', cancelButtonText: '再想想', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await developerStore.revokeWorkingSolution(developer.id)
    await stockStore.load()
    ElMessage.success('工作液已撤销，母液余量已恢复，记录留作已撤销')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤销失败')
  }
}

async function scrapDeveloper(developer: Developer): Promise<void> {
  if (developer.id === undefined) return
  try {
    await developerStore.scrap(developer.id)
    ElMessage.success('该工作液已标记为报废')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

onMounted(async () => {
  await Promise.all([stockStore.load(), developerStore.load()])
  if (mixForm.stockSolutionId === null && stockStore.validStocks[0]?.id !== undefined) {
    mixForm.stockSolutionId = stockStore.validStocks[0].id as number
  }
})
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--compact">
      <div>
        <span class="eyebrow">CHEMISTRY LEDGER</span>
        <h1>母液分装与工作液配制台账</h1>
        <p>母液按瓶登记类别、开封日、有效期与余量；调工作液选母液、稀释比和目标容量，自动扣减并生成配制记录。</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="ghost-button" data-testid="new-mix" @click="showMixForm = !showMixForm">
          {{ showMixForm ? '收起配制' : '调工作液' }}
        </button>
        <button type="button" class="primary-button" data-testid="new-stock" @click="showStockForm = !showStockForm">
          {{ showStockForm ? '收起表单' : '登记母液' }}
        </button>
      </div>
    </header>

    <div class="stat-strip">
      <StatBadge label="在册母液" :value="stockStore.stocks.length" hint="按瓶登记" tone="cyan" />
      <StatBadge label="母液余量合计" :value="stockStore.totalRemainingMl" hint="mL，扣减与撤销恢复实时联动" tone="amber" />
      <StatBadge label="工作液可冲余量" :value="developerStore.availableRolls" hint="卷，不含报废与已撤销" tone="cyan" />
      <StatBadge
        label="终态工作液"
        :value="developerStore.developers.filter((item) => isDeveloperTerminal(item.state)).length"
        hint="报废或已撤销"
        tone="rose"
      />
    </div>

    <!-- 登记母液 -->
    <form v-if="showStockForm" class="inline-form" data-testid="form-stock" @submit.prevent="submitStock">
      <div class="inline-form__head">
        <div>
          <h2>登记母液</h2>
          <p>记录类别、开封日、有效期与初始容量，余量初始等于初始容量，之后只由配制扣减、撤销恢复。</p>
        </div>
      </div>
      <div class="form-grid form-grid--three">
        <label>
          <span>母液名称</span>
          <input v-model="stockForm.name" data-testid="field-stock-name" type="text" placeholder="如 柯达 D-76 母液 1L 装" />
        </label>
        <label>
          <span>类别</span>
          <select v-model="stockForm.category" data-testid="field-stock-category">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label>
          <span>初始容量</span>
          <input v-model.number="stockForm.initialVolumeMl" data-testid="field-stock-volume" type="number" min="1" step="50" />
        </label>
        <label>
          <span>开封日期</span>
          <input v-model="stockForm.openedAt" data-testid="field-stock-openedAt" type="date" />
        </label>
        <label>
          <span>有效期至</span>
          <input v-model="stockForm.expireDate" data-testid="field-stock-expireDate" type="date" />
        </label>
        <label>
          <span>备注</span>
          <input v-model="stockForm.note" data-testid="field-stock-note" type="text" placeholder="储存方式、批号等（可留空）" />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost-button" @click="showStockForm = false">取消</button>
        <button type="submit" class="primary-button" data-testid="submit-stock" :disabled="savingStock">
          {{ savingStock ? '保存中…' : '保存母液' }}
        </button>
      </div>
    </form>

    <!-- 调工作液 -->
    <form v-if="showMixForm" class="inline-form" data-testid="form-mix" @submit.prevent="submitMix">
      <div class="inline-form__head">
        <div>
          <h2>调工作液</h2>
          <p>类别跟随所选母液；按稀释比与目标容量换算母液用量，校验通过后同笔写入扣减、工作液与配制记录。</p>
        </div>
      </div>
      <div class="form-grid form-grid--three">
        <label class="span-2">
          <span>选择母液</span>
          <select v-model.number="mixForm.stockSolutionId" data-testid="field-mix-stock">
            <option v-for="stock in stockStore.stocks" :key="stock.id" :value="stock.id" :disabled="isStockExpired(stock)">
              {{ stock.name }} · {{ stock.category }} · 余量 {{ stock.remainingMl }} mL · 有效期至 {{ stock.expireDate
              }}{{ isStockExpired(stock) ? '（已过期）' : '' }}
            </option>
          </select>
        </label>
        <label>
          <span>配制日期</span>
          <input v-model="mixForm.mixedAt" data-testid="field-mix-mixedAt" type="date" />
        </label>
        <div class="span-2">
          <DilutionInput
            v-model:ratio="mixForm.dilution"
            v-model:working-volume-ml="mixForm.targetVolumeMl"
            ratio-test-id="field-mix-dilution"
            volume-test-id="field-mix-target"
          />
        </div>
        <label>
          <span>工作液名称（可留空自动命名）</span>
          <input v-model="mixForm.name" data-testid="field-mix-name" type="text" :placeholder="suggestedName" />
        </label>
        <div class="span-3 mix-check" :class="`mix-check--${mixCheck.code === 'ok' ? 'ok' : 'bad'}`" data-testid="mix-check">
          <template v-if="selectedStock">
            <strong>{{ mixCheck.code === 'ok' ? '可以配制' : '不能配制' }}</strong>
            <span v-if="mixCheck.code === 'ok'">
              将扣减「{{ selectedStock.name }}」母液 {{ requiredMl }} mL，类别 {{ mixCategory }}，生成 {{ mixForm.targetVolumeMl }}
              mL 工作液（约 {{ estimateRolls(mixForm.targetVolumeMl) }} 卷）
            </span>
            <span v-else>{{ mixCheck.message }}</span>
          </template>
          <span v-else>请先在上面选择一瓶在册母液。</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost-button" @click="showMixForm = false">取消</button>
        <button type="submit" class="primary-button" data-testid="submit-mix" :disabled="savingMix || mixCheck.code !== 'ok'">
          {{ savingMix ? '写入中…' : '扣减母液并生成工作液' }}
        </button>
      </div>
    </form>

    <!-- 母液台账 -->
    <section class="ledger-section">
      <div class="panel__head">
        <div>
          <h2>母液台账</h2>
          <p>分装余量全部归集到此，每一次配制与撤销都可追溯。</p>
        </div>
      </div>
      <div class="dev-grid">
        <article v-for="stock in stockStore.stocks" :key="stock.id" class="entity-card" data-testid="row-stock">
          <div class="entity-card__main">
            <div class="entity-card__title">
              <div>
                <span class="status-chip" :class="`status--${stockState(stock).tone}`">{{ stockState(stock).label }}</span>
                <h2>{{ stock.name }}</h2>
              </div>
            </div>
            <dl class="data-pairs">
              <div><dt>类别</dt><dd>{{ stock.category }}</dd></div>
              <div><dt>开封日</dt><dd>{{ stock.openedAt }}</dd></div>
              <div><dt>有效期至</dt><dd>{{ stock.expireDate }}</dd></div>
              <div><dt>余量 / 初始</dt><dd>{{ stock.remainingMl }} / {{ stock.initialVolumeMl }} mL</dd></div>
            </dl>
            <div class="life-meter">
              <div class="life-meter__track">
                <i :style="{ width: `${stock.initialVolumeMl ? Math.min(100, stock.remainingMl / stock.initialVolumeMl * 100) : 0}%` }"></i>
              </div>
              <small v-if="stock.note">{{ stock.note }}</small>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 工作液清单 -->
    <section class="ledger-section">
      <div class="panel__head">
        <div>
          <h2>工作液清单</h2>
          <p>新工作液由母液配制生成；升级前的旧工作液照常使用，来源标记为未追溯。</p>
        </div>
      </div>
      <div class="dev-grid">
        <article v-for="developer in developerStore.developers" :key="developer.id" class="entity-card developer-card" data-testid="row-developer">
          <div class="entity-card__main">
            <div class="entity-card__title">
              <div>
                <span class="status-chip" :class="`status--${stateTone(developer)}`">{{ developer.state }}</span>
                <h2>{{ developer.name }}</h2>
                <p>{{ stockNameOf(developer) }}</p>
              </div>
              <div v-if="!isDeveloperTerminal(developer.state)" class="card-actions">
                <button
                  v-if="developer.source === 'ledger' && developer.usedRolls === 0"
                  type="button"
                  class="text-button"
                  data-testid="button-revoke"
                  @click="revokeDeveloper(developer)"
                >
                  撤销并恢复余量
                </button>
                <button type="button" class="text-button text-button--danger" @click="scrapDeveloper(developer)">
                  标记报废
                </button>
              </div>
            </div>
            <dl class="data-pairs">
              <div><dt>类型 / 稀释</dt><dd>{{ developer.category }} · {{ developer.dilution }}</dd></div>
              <div><dt>工作液容量</dt><dd>{{ developer.volumeMl }} mL</dd></div>
              <div><dt>配制日期</dt><dd>{{ developer.mixedAt }}</dd></div>
              <div><dt>母液用量</dt><dd>{{ calculateStockVolume(developer.volumeMl, developer.dilution) }} mL</dd></div>
            </dl>
            <div class="life-meter">
              <div class="life-meter__head">
                <span>剩余 {{ remainingRolls(developer.maxRolls, developer.usedRolls) }} 卷</span>
                <span>已用 {{ developer.usedRolls }} / {{ developer.maxRolls }}</span>
              </div>
              <div class="life-meter__track">
                <i :style="{ width: `${Math.min(100, developer.usedRolls / developer.maxRolls * 100)}%` }"></i>
              </div>
              <small v-if="developer.state === '已撤销'">未冲洗已撤销，母液余量已恢复，配制记录留痕。</small>
              <small v-else-if="remainingRolls(developer.maxRolls, developer.usedRolls) === 0">余量已耗尽，建议报废并重新配制。</small>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 配制记录 -->
    <section class="ledger-section">
      <div class="panel">
        <div class="panel__head">
          <div>
            <h2>配制记录</h2>
            <p>分装与配制共用一本账；撤销不删除记录，只改状态为已撤销。</p>
          </div>
        </div>
        <div v-if="developerStore.mixRecords.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>配制日期</th>
                <th>母液来源</th>
                <th>类别 / 稀释</th>
                <th>用量换算</th>
                <th>工作液</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in developerStore.mixRecords" :key="record.id" data-testid="row-mix">
                <td>{{ record.mixedAt }}</td>
                <td>
                  <strong>{{ record.stockName }}</strong>
                  <small>扣减 {{ record.stockUsedMl }} mL</small>
                </td>
                <td>{{ record.category }} · {{ record.dilution }}</td>
                <td>目标 {{ record.targetVolumeMl }} mL 工作液</td>
                <td>
                  {{ developerStore.developers.find((item) => item.id === record.developerId)?.name ?? `工作液 #${record.developerId}` }}
                </td>
                <td>
                  <span class="status-chip" :class="record.status === '有效' ? 'status--cyan' : 'status--rose'">
                    {{ record.status }}
                  </span>
                  <small v-if="record.status === '已撤销' && record.revokedAt"> · {{ record.revokedAt }} 余量已恢复</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyPanel v-else title="还没有配制记录" description="登记母液后调一次工作液，扣减与记录会自动入账。" />
      </div>
    </section>
  </section>
</template>

<style scoped>
.hero-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.ledger-section {
  display: grid;
  gap: 12px;
  margin-top: 22px;
}

.card-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  white-space: nowrap;
}

.mix-check {
  display: grid;
  gap: 4px;
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 12px;
}

.mix-check strong {
  font-size: 14px;
}

.mix-check--ok {
  color: #285f66;
  background: #eef8f7;
  border: 1px solid rgba(41, 127, 137, 0.2);
}

.mix-check--bad {
  color: #983f38;
  background: #fbf0ee;
  border: 1px solid rgba(174, 72, 70, 0.25);
}
</style>
