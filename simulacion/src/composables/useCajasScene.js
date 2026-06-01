import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getFacesRandomDependiente, getRandomPersona } from '@/utils/imagesUtils'

const GLTF_CAJA_PATH = '/assets/3dmodels/psx_cashier_stand/scene.gltf'
const SIZE_CAJA = 1.5
const SEPARACION_CAJAS = 3.5 + SIZE_CAJA
const CAJAS_POR_GRUPO = 3
const ESPACIO_GRUPOS = 2.5
const FACE_SCALE = 0.75
const CARRITO_SCALE = 2.3
const CARRITO_POSITION = new THREE.Vector3(1.5, -0.5, 0)
const OFFSET_X_CAJAS = -2

// Local z in grupo space for animation endpoints.
// Grupo is at world z = -12, so:
//   floor front edge (world z = +16) → local z = +28
//   back wall (world z = -16)        → local z = -4
const ENTRY_Z = 28
const EXIT_Z = -4

//  Animation system

const activeAnimations = []

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function easeIn(t) {
  return t * t
}

export function tickAnimations() {
  for (let i = activeAnimations.length - 1; i >= 0; i--) {
    const anim = activeAnimations[i]
    anim.t = Math.min(1, anim.t + anim.speed)
    anim.mesh.position.lerpVectors(anim.from, anim.to, anim.easing(anim.t))
    if (anim.t >= 1) {
      anim.onComplete?.()
      activeAnimations.splice(i, 1)
    }
  }
}

function startAnimation(mesh, from, to, speed, easing, onComplete) {
  const idx = activeAnimations.findIndex((a) => a.mesh === mesh)
  if (idx !== -1) activeAnimations.splice(idx, 1)
  activeAnimations.push({
    mesh,
    from: from.clone(),
    to: to.clone(),
    t: 0,
    speed,
    easing,
    onComplete,
  })
}

//  Client helpers

function computeClientPos(i) {
  const side = i % 2 === 0 ? -0.9 : 0.9
  return new THREE.Vector3(3.6 + side + Math.sin(i * 2.3) * 0.25, 1.5, 2.4 + i * 1.8)
}

//  Character creators

export function cargarModeloCaja() {
  return new Promise((resolve) => {
    const loader = new GLTFLoader()
    loader.load(GLTF_CAJA_PATH, (gltf) => {
      const modelo = gltf.scene
      modelo.scale.set(SIZE_CAJA, SIZE_CAJA, SIZE_CAJA)
      resolve(modelo)
    })
  })
}

function crearCarrito(imgCarrito) {
  const g = new THREE.Group()
  const tex = new THREE.TextureLoader().load(imgCarrito)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.18, color: 0xd6d6d6 }),
  )
  sprite.scale.set(CARRITO_SCALE, CARRITO_SCALE, 1)
  g.add(sprite)
  return g
}

export function crearDependiente(data = {}) {
  const g = new THREE.Group()
  const loader = new THREE.TextureLoader()

  const cuerpo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 1.0, 20),
    new THREE.MeshStandardMaterial({ color: data.color ?? 0x3b82f6 }),
  )
  cuerpo.position.y = 0.5
  g.add(cuerpo)

  const faceTex = loader.load(data.imagen || getFacesRandomDependiente())
  faceTex.colorSpace = THREE.SRGBColorSpace
  const cabeza = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: faceTex, transparent: true, alphaTest: 0.18, color: 0xd6d6d6 }),
  )
  cabeza.scale.set(FACE_SCALE, FACE_SCALE, 1)
  cabeza.position.y = 1.25
  g.add(cabeza)

  const brazoMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d })
  const brazoGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12)
  const brazoIzq = new THREE.Mesh(brazoGeo, brazoMat)
  brazoIzq.position.set(-0.35, 0.7, 0)
  g.add(brazoIzq)
  const brazoDer = brazoIzq.clone()
  brazoDer.position.x = 0.35
  g.add(brazoDer)

  return g
}

export function crearCliente(data) {
  const g = new THREE.Group()
  const tex = new THREE.TextureLoader().load(data.imagen || getRandomPersona())
  tex.colorSpace = THREE.SRGBColorSpace
  const persona = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.18, color: 0xd6d6d6 }),
  )
  persona.scale.set(2.5, 3.5, 1)
  g.add(persona)

  if (data.imgCarrito != null) {
    const carrito = crearCarrito(data.imgCarrito)
    carrito.position.copy(CARRITO_POSITION)
    g.add(carrito)
  }

  return g
}

//  Queue management

// Instant placement — used only when building the scene from scratch.
export function actualizarCola(grupo, cola) {
  grupo.userData.clientes.forEach((c) => grupo.remove(c))
  grupo.userData.clientes = []
  cola.forEach((data, i) => {
    const cliente = crearCliente(data)
    cliente.position.copy(computeClientPos(i))
    grupo.add(cliente)
    grupo.userData.clientes.push(cliente)
  })
}

/**
 * Animate clients moving laterally between cajas when queues are rebalanced.
 * Must be called BEFORE the data model is mutated so that grupo.userData.clientes
 * is already in sync with the new cola by the time sincronizarCola runs.
 */
export function animarReubicacionColas(cajasMesh, movimientos) {
  if (!movimientos?.length) return

  // Collect mesh references first (before any removal, so indices are stable)
  const tareas = movimientos
    .map((mov) => {
      const sourceGroup = cajasMesh[mov.cajaOrigenIdx]
      const destGroup = cajasMesh[mov.cajaDestinoIdx]
      if (!sourceGroup || !destGroup) return null
      const mesh = sourceGroup.userData.clientes[mov.posOrigen]
      if (!mesh) return null
      return { mesh, sourceGroup, destGroup, posDestino: mov.posDestino }
    })
    .filter(Boolean)

  if (!tareas.length) return

  // Remove all moving meshes from their source groups
  for (const { mesh, sourceGroup } of tareas) {
    const idx = sourceGroup.userData.clientes.indexOf(mesh)
    if (idx !== -1) sourceGroup.userData.clientes.splice(idx, 1)
    sourceGroup.remove(mesh)
  }

  // Group arrivals by destination and process in ascending posDestino order
  const byDest = new Map()
  for (const tarea of tareas) {
    if (!byDest.has(tarea.destGroup)) byDest.set(tarea.destGroup, [])
    byDest.get(tarea.destGroup).push(tarea)
  }

  for (const [destGroup, arrivals] of byDest) {
    arrivals.sort((a, b) => a.posDestino - b.posDestino)
    for (const { mesh, sourceGroup, posDestino } of arrivals) {
      // Convert mesh's former local position in sourceGroup to destGroup local space.
      // Groups are direct scene children with only translation, so world = group.pos + local.
      const localStart = new THREE.Vector3(
        sourceGroup.position.x + mesh.position.x - destGroup.position.x,
        mesh.position.y,
        sourceGroup.position.z + mesh.position.z - destGroup.position.z,
      )
      mesh.position.copy(localStart)
      destGroup.add(mesh)
      destGroup.userData.clientes.splice(posDestino, 0, mesh)
      startAnimation(mesh, localStart.clone(), computeClientPos(posDestino), 0.025, easeInOut, null)
    }
  }
}

// Incremental update with entry / exit animations — used for live changes.
export function sincronizarCola(grupo, cola) {
  const existentes = grupo.userData.clientes
  const huboBajas = existentes.length > cola.length

  // Clients that have been served: animate them past the caja toward the back wall.
  while (existentes.length > cola.length) {
    const mesh = existentes.shift()
    const exitTarget = new THREE.Vector3(mesh.position.x, 1.5, EXIT_Z)
    startAnimation(mesh, mesh.position.clone(), exitTarget, 0.022, easeIn, () => grupo.remove(mesh))
  }

  // Advance remaining clients toward the caja after someone was served.
  if (huboBajas) {
    existentes.forEach((mesh, i) => {
      startAnimation(mesh, mesh.position.clone(), computeClientPos(i), 0.022, easeInOut, null)
    })
  }

  // New clients: spawn at the store entrance and walk to their queue spot.
  for (let i = existentes.length; i < cola.length; i++) {
    const cliente = crearCliente(cola[i])
    const target = computeClientPos(i)
    const entryPos = new THREE.Vector3(target.x, 1.5, ENTRY_Z)
    cliente.position.copy(entryPos)
    grupo.add(cliente)
    existentes.push(cliente)
    startAnimation(cliente, entryPos, target, 0.022, easeInOut, null)
  }
}

//  Scene management

function crearCajaGrupo(caja, x, cajaModelo) {
  const grupo = new THREE.Group()
  grupo.position.set(x + OFFSET_X_CAJAS, 0, -12)
  grupo.userData.caja = caja
  grupo.userData.clientes = []

  const mesh = cajaModelo.clone()
  mesh.rotation.y = Math.PI / 2
  grupo.add(mesh)

  if (caja.dependiente) {
    const dep = crearDependiente(caja.dependiente)
    dep.position.set(0.4, 0, -1.3)
    dep.rotation.y = Math.PI / 2
    grupo.add(dep)
    grupo.userData.dependiente = dep
  } else {
    grupo.userData.dependiente = null
  }

  actualizarCola(grupo, caja.cola)
  return grupo
}

export function limpiarCajasEscena(scene, cajasMesh) {
  activeAnimations.length = 0
  cajasMesh.forEach((m) => scene.remove(m))
  cajasMesh.length = 0
}

export function renderizarCajas(scene, cajas, cajaModelo, cajasMesh, onInitTooltip) {
  if (!scene || !cajaModelo) return
  limpiarCajasEscena(scene, cajasMesh)

  const posX = cajas.map((_, i) => {
    const g = Math.floor(i / CAJAS_POR_GRUPO)
    return (i - (cajas.length - 1) / 2) * (SEPARACION_CAJAS + 0.5) + g * ESPACIO_GRUPOS
  })
  const centroX = posX.length ? (Math.min(...posX) + Math.max(...posX)) / 2 : 0

  cajas.forEach((caja, i) => {
    const grupo = crearCajaGrupo(caja, posX[i] - centroX, cajaModelo)
    cajasMesh.push(grupo)
    scene.add(grupo)
    onInitTooltip(caja.id)
  })
}

export function syncScene(cajas, cajasMesh) {
  cajas.forEach((caja, i) => {
    const grupo = cajasMesh[i]
    if (!grupo) return

    sincronizarCola(grupo, caja.cola)

    const depActual = grupo.userData.dependiente
    if (caja.dependiente && !depActual) {
      const dep = crearDependiente(caja.dependiente)
      dep.position.set(0.4, 0, -1.3)
      dep.rotation.y = Math.PI / 2
      grupo.add(dep)
      grupo.userData.dependiente = dep
    } else if (!caja.dependiente && depActual) {
      grupo.remove(depActual)
      grupo.userData.dependiente = null
    }
  })
}
