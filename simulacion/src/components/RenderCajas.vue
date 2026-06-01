<template>
  <div ref="container" class="scene"></div>

  <!-- Controls panel -->
  <div class="controls-panel">
    <label>
      Velocidad: <strong>{{ simulationSpeed.toFixed(2) }}x</strong>
      <input type="range" v-model.number="simulationSpeed" min="0.5" max="20" step="0.5" />
    </label>
    <label>
      Cámara:
      <select v-model="cameraMode">
        <option v-for="key in Object.keys(POSICIONES_CAMARA)" :key="key" :value="key">
          {{ key.charAt(0).toUpperCase() + key.slice(1) }}
        </option>
      </select>
    </label>
    <label class="toggle">
      <input type="checkbox" v-model="mostrarReferenciasEspaciales" /> Referencias espaciales
    </label>
    <label class="toggle"> <input type="checkbox" v-model="mostrarLabels" /> Etiquetas </label>
    <label class="toggle">
      <input type="checkbox" v-model="saveFrames" /> Enviar frames al servidor
    </label>
    <button
      type="button"
      class="btn-download"
      :class="{ 'is-recording': isRecordingVideo }"
      @click="toggleVideoRecording"
    >
      {{ isRecordingVideo ? 'Detener grabación' : 'Grabar video' }}
    </button>
    <span v-if="isRecordingVideo" class="recording-time">{{ recordingElapsedLabel }}</span>
    <button @click="downloadFrame" class="btn-download">Descargar frame</button>
    <!-- <RouterLink to="/video-stream" class="btn-backend-test">Video stream</RouterLink> -->
  </div>

  <!-- Tooltips for cajas -->
  <div v-for="c in cajas" :key="c.id" class="tooltip" :style="tooltips.getStyle(c.id)">
    <div class="tooltip-card" v-if="mostrarLabels">
      <div class="tooltip-header">
        <strong>Caja {{ c.id }}</strong>
        <div :class="['status-badge', c.abierta ? 'open' : 'closed']">
          {{ c.abierta ? 'Abierta' : 'Cerrada' }}
        </div>
      </div>
      <div class="tooltip-content">👥 {{ c.cola.length }} en cola</div>
    </div>
  </div>

  <!-- Free camera position panel -->
  <div v-if="mostrarReferenciasEspaciales && cameraMode === 'libre'" class="camera-pos-panel">
    <span class="camera-pos-label">Posición</span>
    <code class="camera-pos-coords"
      >new THREE.Vector3({{ camera.position.x.toFixed(2) }}, {{ camera.position.y.toFixed(2) }},
      {{ camera.position.z.toFixed(2) }})</code
    >
    <span class="camera-pos-label">Mirando hacia</span>
    <code class="camera-pos-coords"
      >new THREE.Vector3({{ camControls?.controls?.target?.x.toFixed(2) }},
      {{ camControls?.controls?.target?.y.toFixed(2) }},
      {{ camControls?.controls?.target?.z.toFixed(2) }})</code
    >
    <button
      class="btn-copy-coords"
      :class="{ copied: posicionCopiada }"
      @click="copiarPosicionCamara"
    >
      {{ posicionCopiada ? '✓' : 'Copiar' }}
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import './RenderCajas.css'
import * as THREE from 'three'
import { VideoWS } from '@/services/backendApi.js'
import { createVideoRecorder } from '@/utils/videoRecorder.js'

import { crearFondoEscena, crearSuelo, crearLuces } from '@/composables/useSceneSetup.js'
import { crearParedes } from '@/composables/useWalls.js'
import { useTooltips } from '@/composables/useTooltips.js'
import {
  cargarModeloCaja,
  renderizarCajas,
  syncScene,
  tickAnimations,
  animarReubicacionColas,
} from '@/composables/useCajasScene.js'
import { simulationSpeed } from '@/models/simulacionConfig.js'
import { initCameraControls } from '@/composables/useCameraControls.js'
import { POSICIONES_CAMARA, CAMARA_POR_DEFECTO } from '@/composables/camarasConfig.js'
import { useReferenciasEspaciales } from '@/composables/useReferenciasEspaciales.js'
import { workerSetInterval, workerClearInterval } from '@/utils/workerTimer.js'

const SUELO_LARGO = 40
const SUELO_ANCHO = 32

const FPS_SEND_RENDER = 24

// Resolución fija de renderización — debe coincidir con el vídeo de demo (3d_demo.webm).
// El buffer del renderer siempre se mantiene a esta resolución para que los frames
// enviados al backend por WebSocket sean idénticos al vídeo de referencia.
// CSS escala el canvas para que llene el contenedor sin cambiar el buffer.
const RENDER_WIDTH = 1904
const RENDER_HEIGHT = 935

const VIDEO_RECORDING_FPS = 30

const props = defineProps({
  simulacion: { type: Object, default: null },
})

const container = ref(null)
const cajas = computed(() => props.simulacion?.cajas ?? [])

const saveFrames = ref(true)
const isRecordingVideo = ref(false)
const recordingElapsedSeconds = ref(0)
const cameraMode = ref(CAMARA_POR_DEFECTO)
const mostrarReferenciasEspaciales = ref(false)
const mostrarLabels = ref(false)
const posicionCopiada = ref(false)

const tooltips = useTooltips()
const refEspaciales = useReferenciasEspaciales(SUELO_LARGO, SUELO_ANCHO)

let scene, camera, renderer, animationId, cajaModelo, camControls, videoRecorder
const cajasMesh = []
const frameStreamer = new VideoWS()

// Loop de fondo: sustituye a rAF cuando la pestaña está oculta para que las
// animaciones de clientes y el canvas sigan actualizándose (rAF se pausa en tabs ocultas).
// Debe coincidir con FPS_SEND_RENDER para evitar frames duplicados en el stream.
let backgroundLoopId = null

function startBackgroundLoop() {
  if (backgroundLoopId !== null) return
  backgroundLoopId = workerSetInterval(() => {
    if (!renderer) return
    tickAnimations()
    renderer.render(scene, camera)
  }, 1000 / FPS_SEND_RENDER)
}

function stopBackgroundLoop() {
  workerClearInterval(backgroundLoopId)
  backgroundLoopId = null
}

function onVisibilityChange() {
  if (document.hidden) startBackgroundLoop()
  else stopBackgroundLoop()
}

const recordingElapsedLabel = computed(() => {
  const m = Math.floor(recordingElapsedSeconds.value / 60)
  const s = recordingElapsedSeconds.value % 60
  return `Grabando ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

async function init() {
  scene = new THREE.Scene()
  scene.background = crearFondoEscena()

  // Aspecto fijo: coincide con RENDER_WIDTH/RENDER_HEIGHT para coherencia con el backend
  camera = new THREE.PerspectiveCamera(55, RENDER_WIDTH / RENDER_HEIGHT, 0.1, 100)
  camera.position.copy(POSICIONES_CAMARA[cameraMode.value].position)

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  // Buffer fijo a RENDER_WIDTH×RENDER_HEIGHT; CSS llena el contenedor sin cambiar el buffer
  renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.shadowMap.enabled = true
  container.value.appendChild(renderer.domElement)

  camControls = initCameraControls(camera, renderer, cameraMode.value)
  window.addEventListener('keydown', camControls.onKeyDown)
  window.addEventListener('keyup', camControls.onKeyUp)

  crearLuces(scene, SUELO_LARGO)

  const suelo = crearSuelo(SUELO_LARGO, SUELO_ANCHO)
  suelo.rotation.x = -Math.PI / 2
  suelo.receiveShadow = true
  scene.add(suelo)

  await crearParedes(scene, SUELO_LARGO, SUELO_ANCHO)

  if (mostrarReferenciasEspaciales.value) refEspaciales.crear(scene)

  cargarModeloCaja().then((modelo) => {
    cajaModelo = modelo
    renderizarCajas(scene, cajas.value, cajaModelo, cajasMesh, tooltips.initForCaja)
  })

  animate()
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (document.hidden) startBackgroundLoop()

  if (saveFrames.value) {
    frameStreamer
      .connect()
      .then(() => frameStreamer.startStreaming(renderer, FPS_SEND_RENDER))
      .catch((e) => console.error('[VideoWS] Error al conectar:', e))
  }
  window.addEventListener('resize', onResize)
}

function animate() {
  animationId = requestAnimationFrame(animate)
  camControls.controls.update()
  camControls.updateWASD()
  tickAnimations()

  cajasMesh.forEach((mesh) => {
    const id = mesh.userData?.caja?.id
    if (id != null) tooltips.updatePosition(mesh, id, camera, renderer)
  })

  renderer.render(scene, camera)
}

function onResize() {
  // El buffer del renderer es fijo (RENDER_WIDTH×RENDER_HEIGHT); solo el CSS cambia de tamaño.
  // La cámara mantiene el aspect ratio de renderización para coherencia con el backend.
  // No hay nada que actualizar: el canvas ya tiene width/height en 100% y el contenedor
  // absorbe el resize del navegador.
}

function copiarPosicionCamara() {
  const { x, y, z } = camera.position
  const t = camControls.controls.target
  navigator.clipboard.writeText(
    `newCameraPos: {\n` +
      `    position: new THREE.Vector3(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}),\n` +
      `    lookAt: new THREE.Vector3(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}),\n` +
      `  },`,
  )
  posicionCopiada.value = true
  setTimeout(() => (posicionCopiada.value = false), 1500)
}

function downloadFrame() {
  if (!renderer) return
  renderer.domElement.toBlob(
    (blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `frame-${Date.now()}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    },
    'image/jpeg',
    0.95,
  )
}

function toggleVideoRecording() {
  if (!videoRecorder && renderer) {
    videoRecorder = createVideoRecorder(renderer, {
      fps: VIDEO_RECORDING_FPS,
      filenamePrefix: 'render',
    })
  }
  if (isRecordingVideo.value) {
    videoRecorder?.stop()
    return
  }
  const started = videoRecorder?.start({
    onTick: (s) => {
      recordingElapsedSeconds.value = s
    },
    onStart: () => {
      isRecordingVideo.value = true
      recordingElapsedSeconds.value = 0
    },
    onStop: () => {
      isRecordingVideo.value = false
      recordingElapsedSeconds.value = 0
    },
  })
  if (!started) {
    isRecordingVideo.value = false
    recordingElapsedSeconds.value = 0
  }
}

watch(saveFrames, async (val) => {
  if (val) {
    if (!renderer) return
    try {
      await frameStreamer.connect()
      frameStreamer.startStreaming(renderer, FPS_SEND_RENDER)
    } catch (e) {
      console.error('[VideoWS] No se pudo conectar:', e)
      saveFrames.value = false
    }
  } else {
    frameStreamer.stopStreaming()
    frameStreamer.disconnect()
  }
})

watch(mostrarReferenciasEspaciales, (val) => {
  if (!scene) return
  if (val) refEspaciales.crear(scene)
  else refEspaciales.limpiar(scene)
})

watch(cameraMode, (mode) => {
  if (camControls) camControls.setMode(mode)
})

// Register the rebalancing hook so nivelarColas triggers lateral animations.
watch(
  () => props.simulacion,
  (sim) => {
    if (sim) sim._onNivelarColas = (movimientos) => animarReubicacionColas(cajasMesh, movimientos)
  },
  { immediate: true },
)

// Rebuild cajas only when their count changes (e.g. a new caja is added/removed).
watch(
  () => props.simulacion?.cajas?.length,
  () => {
    if (scene && cajaModelo)
      renderizarCajas(scene, cajas.value, cajaModelo, cajasMesh, tooltips.initForCaja)
  },
)

// Animate queue / state changes (client joins or leaves).
watch(
  () => props.simulacion,
  () => syncScene(cajas.value, cajasMesh),
  { deep: true, immediate: true },
)

onMounted(init)

onBeforeUnmount(() => {
  cancelAnimationFrame(animationId)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopBackgroundLoop()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', camControls?.onKeyDown)
  window.removeEventListener('keyup', camControls?.onKeyUp)
  camControls?.controls?.dispose()
  refEspaciales.limpiar(scene)
  videoRecorder?.dispose()
  renderer?.dispose()
  frameStreamer.stopStreaming()
  frameStreamer.disconnect()
})
</script>
