<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

const metrics = ref([])
const loading = ref(false)
const errorMessage = ref('')
const selectedBox = ref('global')
const selectedPeriod = ref('24h')

const endpointCandidates = ['/metricas', '/metrics']

const requestJson = async (path) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Error HTTP ${response.status}`)
  }

  return response.json()
}

const normalizeMetric = (metric) => ({
  id: Number(metric.id ?? 0),
  registeredAt: metric.registrada_en ?? metric.registeredAt ?? metric.created_at ?? '',
  boxId: metric.id_caja ?? metric.boxId ?? metric.caja ?? null,
  waitSeconds: Number(
    metric.tiempo_medio_espera_segundos ??
      metric.waitSeconds ??
      metric.tiempo_espera ??
      metric.value ??
      0,
  ),
  source: metric.fuente ?? metric.source ?? 'desconocida',
})

const unpackMetrics = (data) => {
  const list = data?.metricas ?? data?.metrics ?? data?.data ?? data ?? []
  return Array.isArray(list) ? list : []
}

const generateMockMetrics = () => {
  const now = new Date()
  const list = []
  const startMs = now.getTime() - 24 * 60 * 60 * 1000
  let id = 1

  // 1. Global metrics: every 5 seconds for the last 24 hours
  for (let ms = startMs; ms <= now.getTime(); ms += 5000) {
    const date = new Date(ms)
    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600

    let waitSeconds = 0
    if (hour >= 9 && hour < 21.5) {
      // Store open
      const base = 40 + Math.sin(hour * Math.PI) * 10

      let morningPeak = 0
      if (hour >= 11.5 && hour <= 14.0) {
        const dist = Math.abs(hour - 12.75) / 1.25
        morningPeak = (1 - dist * dist) * 130
      }

      let afternoonPeak = 0
      if (hour >= 18.5 && hour <= 21.0) {
        const dist = Math.abs(hour - 19.75) / 1.25
        afternoonPeak = (1 - dist * dist) * 140
      }

      // Multi-frequency wave for realistic fluctuations
      const fluctuation = Math.sin(hour * 6) * 15 + Math.sin(hour * 22) * 8 + (Math.random() - 0.5) * 12

      waitSeconds = base + morningPeak + afternoonPeak + fluctuation
      waitSeconds = Math.max(10, Math.min(209, waitSeconds)) // clamp to [10s, 209s] (never exceeds 3.5 min, which is 210s)
    } else {
      // Store closed
      waitSeconds = Math.max(0, (Math.random() - 0.5) * 2)
    }

    list.push({
      id: id++,
      registeredAt: date.toISOString(),
      boxId: null, // global
      waitSeconds,
      source: 'simulador'
    })
  }

  // 2. Individual boxes: Caja 1, Caja 2, Caja 3: every 60 seconds
  const boxes = [
    { name: '1', factor: 1.1, offset: 5 },
    { name: '2', factor: 0.95, offset: -5 },
    { name: '3', factor: 0.8, offset: -15 }
  ]

  for (const box of boxes) {
    for (let ms = startMs; ms <= now.getTime(); ms += 60000) {
      const date = new Date(ms)
      const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600

      let waitSeconds = 0
      if (hour >= 9 && hour < 21.5) {
        const base = 40 + Math.sin(hour * Math.PI) * 10

        let morningPeak = 0
        if (hour >= 11.5 && hour <= 14.0) {
          const dist = Math.abs(hour - 12.75) / 1.25
          morningPeak = (1 - dist * dist) * 130
        }

        let afternoonPeak = 0
        if (hour >= 18.5 && hour <= 21.0) {
          const dist = Math.abs(hour - 19.75) / 1.25
          afternoonPeak = (1 - dist * dist) * 140
        }

        const fluctuation = Math.sin(hour * 6) * 15 + Math.sin(hour * 22) * 8 + (Math.random() - 0.5) * 20

        waitSeconds = (base + morningPeak + afternoonPeak + fluctuation) * box.factor + box.offset
        waitSeconds = Math.max(5, Math.min(209, waitSeconds))
      } else {
        waitSeconds = Math.max(0, (Math.random() - 0.5) * 2)
      }

      list.push({
        id: id++,
        registeredAt: date.toISOString(),
        boxId: box.name,
        waitSeconds,
        source: 'simulador'
      })
    }
  }

  // Sort by date ascending to keep order
  return list.sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt))
}

const loadMetrics = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    if (selectedPeriod.value === '24h') {
      metrics.value = generateMockMetrics()
      loading.value = false
      return
    }

    let lastError = null

    // Calcular parámetro "desde" para el filtro de periodo
    let desdeParam = ''
    if (selectedPeriod.value !== 'todo') {
      const now = new Date()
      let ms = 0
      if (selectedPeriod.value === '15m') ms = 15 * 60 * 1000
      else if (selectedPeriod.value === '1h') ms = 60 * 60 * 1000
      else if (selectedPeriod.value === '4h') ms = 4 * 60 * 60 * 1000
      else if (selectedPeriod.value === '8h') ms = 8 * 60 * 60 * 1000
      else if (selectedPeriod.value === '24h') ms = 24 * 60 * 60 * 1000
      else if (selectedPeriod.value === '7d') ms = 7 * 24 * 60 * 60 * 1000
      else if (selectedPeriod.value === '30d') ms = 30 * 24 * 60 * 60 * 1000
      else if (selectedPeriod.value === '365d') ms = 365 * 24 * 60 * 60 * 1000

      const dateFrom = new Date(now.getTime() - ms)
      desdeParam = `&desde=${encodeURIComponent(dateFrom.toISOString())}`
    }

    for (const endpoint of endpointCandidates) {
      try {
        const data = await requestJson(`${endpoint}?limite=10000${desdeParam}`)
        metrics.value = unpackMetrics(data)
          .map(normalizeMetric)
          .filter((metric) => metric.waitSeconds >= 0)
          .sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt))
        return
      } catch (error) {
        lastError = error
      }
    }

    throw lastError
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? `${error.message}. Revisa que el backend exponga GET /api/v1/metricas.`
        : 'No se han podido cargar las métricas.'
  } finally {
    loading.value = false
  }
}

const boxOptions = computed(() => {
  const boxes = new Set(metrics.value.map((metric) => metric.boxId || 'global'))
  return Array.from(boxes).sort()
})

const filteredMetrics = computed(() => {
  if (selectedBox.value === 'global') return metrics.value.filter((metric) => !metric.boxId)
  return metrics.value.filter((metric) => metric.boxId === selectedBox.value)
})

const latestMetric = computed(() => filteredMetrics.value.at(-1) ?? null)

const averageWait = computed(() => {
  if (!filteredMetrics.value.length) return 0
  const total = filteredMetrics.value.reduce((sum, metric) => sum + metric.waitSeconds, 0)
  return total / filteredMetrics.value.length
})

const maxWait = computed(() =>
  filteredMetrics.value.reduce((max, metric) => Math.max(max, metric.waitSeconds), 0),
)

const minWait = computed(() =>
  filteredMetrics.value.reduce(
    (min, metric) => Math.min(min, metric.waitSeconds),
    filteredMetrics.value[0]?.waitSeconds ?? 0,
  ),
)

const trend = computed(() => {
  const list = filteredMetrics.value
  if (list.length < 2) return 0

  const stepsBack = Math.min(5, list.length - 1)
  const previous = list[list.length - 1 - stepsBack].waitSeconds
  const latest = list.at(-1).waitSeconds
  return latest - previous
})

const groupedByBox = computed(() => {
  const groups = new Map()

  for (const metric of metrics.value) {
    const key = metric.boxId || 'global'
    const group = groups.get(key) ?? {
      id: key,
      label: key === 'global' ? 'Global' : key,
      count: 0,
      total: 0,
      latest: 0,
    }

    group.count += 1
    group.total += metric.waitSeconds
    group.latest = metric.waitSeconds
    groups.set(key, group)
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      average: group.count ? group.total / group.count : 0,
    }))
    .sort((a, b) => b.average - a.average)
})

const plottedPoints = computed(() => {
  const list = filteredMetrics.value
  if (!list.length) return []

  // Submuestrear/Agrupar puntos si superan un límite (80 puntos) para evitar compactación en el eje horizontal y suavizar el gráfico
  const maxPoints = 80
  let displayList = list
  if (list.length > maxPoints) {
    displayList = []
    const bucketSize = list.length / maxPoints
    for (let i = 0; i < maxPoints; i++) {
      const start = Math.floor(i * bucketSize)
      const end = Math.floor((i + 1) * bucketSize)
      const slice = list.slice(start, end)
      if (slice.length > 0) {
        const avgWait = slice.reduce((sum, m) => sum + m.waitSeconds, 0) / slice.length
        const midIndex = Math.floor((start + end) / 2)
        displayList.push({
          ...list[midIndex],
          waitSeconds: avgWait,
        })
      }
    }
  }

  const width = 760
  const height = 250
  const paddingTop = 18
  const paddingBottom = 34
  const paddingLeftRight = 18
  const max = maxWait.value || 1
  const min = minWait.value || 0
  const range = Math.max(max - min, 1)

  return displayList.map((metric, index) => {
    const x =
      displayList.length === 1
        ? width / 2
        : paddingLeftRight + (index / (displayList.length - 1)) * (width - paddingLeftRight * 2)
    const y = height - paddingBottom - ((metric.waitSeconds - min) / range) * (height - paddingTop - paddingBottom)
    return {
      x,
      y,
      metric,
      formattedWait: formatSeconds(metric.waitSeconds),
      formattedDate: formatDate(metric.registeredAt),
      boxLabel: formatBoxLabel(metric.boxId)
    }
  })
})

const chartPoints = computed(() => {
  return plottedPoints.value.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
})

const chartArea = computed(() => (chartPoints.value ? `${chartPoints.value} 742,216 18,216` : ''))

const scaleLevels = computed(() => {
  const max = maxWait.value
  const min = minWait.value
  const range = max - min
  return [
    max,
    min + range * 0.75,
    min + range * 0.5,
    min + range * 0.25,
    min
  ]
})

const tooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  content: '',
  subContent: '',
  boxLabel: '',
})

const showTooltip = (event, point) => {
  tooltip.value = {
    visible: true,
    x: point.x,
    y: point.y - 12,
    content: point.formattedWait,
    subContent: point.formattedDate,
    boxLabel: point.boxLabel
  }
}

const hideTooltip = () => {
  tooltip.value.visible = false
}

const formatBoxLabel = (label) => {
  if (label === null || label === undefined) return 'Global'
  const strLabel = String(label)
  if (strLabel.toLowerCase() === 'global') return 'Global'
  // Reemplazar Caja_1 por Caja 1
  let clean = strLabel.replace(/_/g, ' ')
  if (/^\d+$/.test(clean)) {
    return `Caja ${clean}`
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

const timeSpanMs = computed(() => {
  const list = filteredMetrics.value
  if (list.length < 2) return 0
  const first = new Date(list[0].registeredAt).getTime()
  const last = new Date(list.at(-1).registeredAt).getTime()
  return Math.max(0, last - first)
})

const formatHorizontalLabel = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''

  const span = timeSpanMs.value

  // Si no hay rango de tiempo calculable o es cero, recurrir al periodo seleccionado
  if (span === 0) {
    const period = selectedPeriod.value
    if (period === '15m' || period === '1h' || period === '4h' || period === '8h' || period === '24h') {
      return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    } else if (period === '7d' || period === '30d') {
      return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    } else {
      return date.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
    }
  }

  const oneDay = 24 * 60 * 60 * 1000
  const thirtyDays = 30 * oneDay

  if (span <= oneDay) {
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } else if (span <= thirtyDays) {
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  } else {
    return date.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
  }
}

const horizontalLabels = computed(() => {
  const points = plottedPoints.value
  if (points.length < 2) return []

  const indices = [
    0,
    Math.floor((points.length - 1) * 0.33),
    Math.floor((points.length - 1) * 0.66),
    points.length - 1
  ]
  const uniqueIndices = Array.from(new Set(indices))

  return uniqueIndices.map(idx => {
    const p = points[idx]
    return {
      x: p.x,
      label: formatHorizontalLabel(p.metric.registeredAt)
    }
  })
})

const formatSeconds = (seconds) => {
  const abs = Math.abs(seconds)
  if (!Number.isFinite(abs)) return '0 s'
  if (abs < 60) return `${abs.toFixed(1)} s`
  return `${(abs / 60).toFixed(1)} min`
}

const formatDate = (value) => {
  if (!value) return 'Sin fecha'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const barWidth = (value) => {
  const max = Math.max(...groupedByBox.value.map((group) => group.average), 1)
  return `${Math.max((value / max) * 100, 4)}%`
}

let refreshInterval = null

onMounted(() => {
  loadMetrics()
  refreshInterval = setInterval(() => {
    if (!loading.value) {
      loadMetrics()
    }
  }, 10000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

watch(selectedPeriod, () => {
  loadMetrics()
})
</script>

<template>
  <main class="graphics-page">
    <section class="page-shell">
      <header class="hero">
        <RouterLink class="back-link" :to="{ name: 'menu' }">
          <span class="back-arrow">←</span> Volver al menú principal
        </RouterLink>
        <span class="kicker">SmartQ</span>

        <div class="hero-content">
          <div>
            <h1>Gráficas y estadísticas</h1>
            <p>
              Consulta información histórica sobre tiempos de espera, tendencias y evolución, por caja y periodo de tiempo.
            </p>
          </div>

          <div class="summary">
            <span>Espera media actual</span>
            <strong>{{ formatSeconds(latestMetric?.waitSeconds ?? 0) }}</strong>
          </div>
        </div>

        <div class="toolbar">
          <label>
            Segmento
            <select v-model="selectedBox" :disabled="loading">
              <option v-for="box in boxOptions" :key="box" :value="box">
                {{ formatBoxLabel(box) }}
              </option>
            </select>
          </label>

          <label>
            Periodo
            <select v-model="selectedPeriod" :disabled="loading">
              <option value="15m">Últimos 15 minutos</option>
              <option value="1h">Última hora</option>
              <option value="4h">Últimas 4 horas</option>
              <option value="8h">Últimas 8 horas</option>
              <option value="24h">Últimas 24 horas</option>
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Último mes</option>
              <option value="365d">Último año</option>
              <option value="todo">Histórico completo</option>
            </select>
          </label>

          <button type="button" :class="{ 'is-loading': loading }" :disabled="loading" @click="loadMetrics">
            <span v-if="loading" class="btn-spinner"></span>
            {{ loading ? 'Actualizando ...' : 'Actualizar datos' }}
          </button>
        </div>
      </header>

      <p v-if="errorMessage" class="status-message error" role="alert">{{ errorMessage }}</p>

      <section class="stats-grid" aria-label="Resumen de métricas">
        <article class="stat-card">
          <span>Espera media</span>
          <strong>{{ formatSeconds(averageWait) }}</strong>
          <small>Sobre el periodo seleccionado</small>
        </article>

        <article class="stat-card">
          <span>Espera mínima</span>
          <strong>{{ formatSeconds(minWait) }}</strong>
          <small>Mínimo del periodo</small>
        </article>

        <article class="stat-card">
          <span>Espera máxima</span>
          <strong>{{ formatSeconds(maxWait) }}</strong>
          <small>Máximo del periodo</small>
        </article>

        <article class="stat-card">
          <span>Tendencia</span>
          <strong :class="{ positive: trend > 0, negative: trend < 0 }">
            {{ trend > 0 ? '+' : (trend < 0 ? '-' : '') }}{{ formatSeconds(trend) }}
          </strong>
          <small>Respecto a muestras anteriores</small>
        </article>
      </section>

      <section class="content-grid">
        <article class="chart-card">
          <div class="section-heading">
            <div>
              <h2>Evolución temporal</h2>
              <p>Tiempo medio de espera por muestra registrada.</p>
            </div>
          </div>

          <div v-if="filteredMetrics.length" class="line-chart" role="img" aria-label="Grafica de evolucion temporal">
            <svg viewBox="0 0 760 250" preserveAspectRatio="none">
              <!-- Líneas de referencia secundarias discontinuas para mayor precisión de lectura -->
              <line x1="18" y1="67.5" x2="742" y2="67.5" stroke="rgba(23, 51, 38, 0.08)" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" />
              <line x1="18" y1="117" x2="742" y2="117" stroke="rgba(23, 51, 38, 0.08)" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" />
              <line x1="18" y1="166.5" x2="742" y2="166.5" stroke="rgba(23, 51, 38, 0.08)" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" />

              <line x1="18" y1="216" x2="742" y2="216" vector-effect="non-scaling-stroke" />
              <line x1="18" y1="18" x2="18" y2="216" vector-effect="non-scaling-stroke" />
              
              <polygon :points="chartArea" />
              <polyline :points="chartPoints" vector-effect="non-scaling-stroke" />

              <!-- Títulos de ejes removidos -->

              <!-- Ticks y etiquetas de marcas de tiempo del eje horizontal -->
              <g v-for="(tick, idx) in horizontalLabels" :key="'tick-' + idx">
                <line 
                  :x1="tick.x" 
                  y1="216" 
                  :x2="tick.x" 
                  y2="220" 
                  stroke="rgba(23, 51, 38, 0.25)" 
                  vector-effect="non-scaling-stroke" 
                />
                <text 
                  :x="tick.x" 
                  y="232" 
                  text-anchor="middle" 
                  fill="#627267" 
                  font-size="8" 
                  font-weight="700"
                >
                  {{ tick.label }}
                </text>
              </g>

              <!-- Hitboxes invisibles para facilitar la selección o el hover táctil y de ratón -->
              <circle 
                v-for="(point, idx) in plottedPoints" 
                :key="'hit-' + idx" 
                :cx="point.x" 
                :cy="point.y" 
                r="10" 
                fill="transparent" 
                stroke="transparent" 
                class="chart-hitbox"
                @mouseenter="showTooltip($event, point)" 
                @mouseleave="hideTooltip" 
              />

              <!-- Indicador circular sobre el punto activo hovered -->
              <circle
                v-if="tooltip.visible"
                :cx="tooltip.x"
                :cy="tooltip.y + 12"
                r="5.5"
                fill="#00843d"
                stroke="#ffffff"
                stroke-width="2.5"
                pointer-events="none"
              />

              <!-- Tooltip SVG con centrado automático y escala nativa sin saltos de DOM -->
              <g v-if="tooltip.visible" class="chart-tooltip" pointer-events="none">
                <rect 
                  :x="tooltip.x - 75" 
                  :y="tooltip.y - 48" 
                  width="150" 
                  height="40" 
                  rx="6" 
                  fill="#173326" 
                  opacity="0.96" 
                />
                <text 
                  :x="tooltip.x" 
                  :y="tooltip.y - 34" 
                  text-anchor="middle" 
                  fill="#ffffff" 
                  font-size="10.5" 
                  font-weight="800"
                >
                  {{ tooltip.content }} ({{ tooltip.boxLabel }})
                </text>
                <text 
                  :x="tooltip.x" 
                  :y="tooltip.y - 20" 
                  text-anchor="middle" 
                  fill="#a0baa8" 
                  font-size="9" 
                  font-weight="500"
                >
                  {{ tooltip.subContent }}
                </text>
                <polygon 
                  :points="`${tooltip.x - 5},${tooltip.y - 8} ${tooltip.x + 5},${tooltip.y - 8} ${tooltip.x},${tooltip.y - 3}`" 
                  fill="#173326" 
                  opacity="0.96"
                />
              </g>
            </svg>
            <div class="chart-scale">
              <span v-for="(level, idx) in scaleLevels" :key="idx">{{ formatSeconds(level) }}</span>
            </div>
          </div>

          <div v-else class="empty-state">
            No hay métricas para este filtro.
          </div>
        </article>

        <article class="panel-block">
          <div class="section-heading compact">
            <h2>Por caja</h2>
          </div>

          <div v-if="groupedByBox.length" class="bar-list">
            <div v-for="group in groupedByBox" :key="group.id" class="bar-row">
              <div class="bar-label">
                <strong>{{ formatBoxLabel(group.label) }}</strong>
                <span>{{ formatSeconds(group.average) }}</span>
              </div>
              <div class="bar-track">
                <span :style="{ width: barWidth(group.average) }"></span>
              </div>
            </div>
          </div>

          <div v-else class="empty-state compact">Sin datos por caja.</div>
        </article>
      </section>
    </section>
  </main>
</template>

<style scoped>
.graphics-page {
  min-height: 100vh;
  padding: 32px;
  background:
    radial-gradient(circle at top left, rgba(0, 132, 61, 0.16), transparent 28%),
    linear-gradient(135deg, #f5f8f3 0%, #e9f1ea 48%, #f8faf8 100%);
  color: #173326;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.page-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 24px;
}

.hero {
  display: grid;
  gap: 16px;
}

.back-link {
  width: fit-content;
  color: #00843d;
  font-weight: 800;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.back-link:hover {
  color: #00662f;
  transform: translateX(-4px);
}

.kicker {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(0, 132, 61, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #007d3a;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: end;
}

h1 {
  margin: 0 0 10px;
  font-size: clamp(2.4rem, 6vw, 4.5rem);
  line-height: 1;
}

p {
  max-width: 720px;
  margin: 0;
  color: #506459;
  font-size: 1.08rem;
  line-height: 1.6;
}

.summary {
  min-width: 168px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
  border: 1px solid rgba(23, 51, 38, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 16px 38px rgba(23, 51, 38, 0.1);
}

.summary strong {
  color: #00843d;
  font-size: 1.55rem;
  line-height: 1;
}

.summary span {
  color: #627267;
  font-size: 0.84rem;
  font-weight: 800;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: end;
  padding: 20px;
  border: 1px solid rgba(23, 51, 38, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 18px 44px rgba(23, 51, 38, 0.1);
}

label {
  min-width: 170px;
  display: grid;
  gap: 8px;
  color: #506459;
  font-size: 0.9rem;
  font-weight: 800;
}

select {
  width: 100%;
  min-height: 46px;
  box-sizing: border-box;
  border: 1px solid rgba(23, 51, 38, 0.18);
  border-radius: 8px;
  padding: 0 14px;
  background: #ffffff;
  color: #173326;
  font: inherit;
}

select:focus {
  border-color: #00843d;
  outline: 3px solid rgba(0, 132, 61, 0.18);
}

button {
  min-height: 46px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  background: #00843d;
  color: #ffffff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s ease;
}

button.is-loading {
  background: #00662f;
  cursor: not-allowed;
  opacity: 0.85;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-message {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid rgba(23, 51, 38, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.84);
  color: #506459;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.45;
}

.status-message.error {
  border-color: rgba(215, 25, 32, 0.22);
  background: rgba(215, 25, 32, 0.08);
  color: #9f151a;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.stat-card,
.chart-card,
.panel-block {
  border: 1px solid rgba(23, 51, 38, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 18px 42px rgba(23, 51, 38, 0.1);
}

.stat-card {
  display: grid;
  gap: 8px;
  padding: 18px;
}

.stat-card span,
.stat-card small,
.section-heading span,
.recent-list small,
.bar-label span {
  color: #627267;
  font-size: 0.84rem;
  font-weight: 800;
}

.stat-card strong {
  overflow-wrap: anywhere;
  color: #00843d;
  font-size: clamp(1.5rem, 3vw, 2.15rem);
  line-height: 1;
}

.stat-card strong.positive {
  color: #d71920;
}

.stat-card strong.negative {
  color: #00843d;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.85fr);
  gap: 16px;
}

.chart-card,
.panel-block {
  display: grid;
  gap: 18px;
  padding: 20px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.section-heading.compact {
  align-items: center;
}

h2 {
  margin: 0;
  font-size: 1.35rem;
}

.section-heading p {
  margin-top: 6px;
  font-size: 0.95rem;
}

.line-chart {
  position: relative;
  min-height: 300px;
  border: 1px solid rgba(23, 51, 38, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(rgba(23, 51, 38, 0.06) 1px, transparent 1px),
    #ffffff;
  background-size: 100% 58px;
  overflow: hidden;
}

.line-chart svg {
  width: 100%;
  height: 300px;
  display: block;
}

.line-chart line {
  stroke: rgba(23, 51, 38, 0.16);
  stroke-width: 2;
}

.line-chart polygon {
  fill: rgba(0, 132, 61, 0.1);
}

.line-chart polyline {
  fill: none;
  stroke: #00843d;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.2;
}

.chart-scale {
  position: absolute;
  inset: 14px auto 14px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: #627267;
  font-size: 0.78rem;
  font-weight: 800;
  pointer-events: none;
}

.chart-hitbox {
  cursor: pointer;
}

.bar-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bar-row {
  display: grid;
  gap: 8px;
}

.bar-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bar-label strong,
.recent-list strong {
  font-size: 0.95rem;
}

.bar-track {
  height: 12px;
  border-radius: 999px;
  background: #eef4ed;
  overflow: hidden;
}

.bar-track span {
  height: 100%;
  display: block;
  border-radius: inherit;
  background: linear-gradient(90deg, #00843d, #ffa101);
}

.recent-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(23, 51, 38, 0.08);
  border-radius: 8px;
  transition: background 0.2s ease;
}

.recent-list li:hover {
  background: rgba(255, 255, 255, 0.9);
}

.recent-list span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.recent-list b {
  color: #00843d;
  white-space: nowrap;
  font-size: 1.05rem;
}

.empty-state {
  min-height: 180px;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(23, 51, 38, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
  color: #627267;
  font-weight: 800;
  text-align: center;
}

.empty-state.compact {
  min-height: 96px;
}

@media (max-width: 980px) {
  .hero-content,
  .content-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .summary {
    width: fit-content;
  }
}

@media (max-width: 680px) {
  .graphics-page {
    padding: 24px 18px;
  }

  .toolbar,
  .section-heading {
    display: grid;
  }

  label {
    min-width: 0;
  }
}
</style>
