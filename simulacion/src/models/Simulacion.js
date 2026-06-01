import Caja from './Caja.js'
import { getCajas, getQueues } from '../services/backendApi.js'
import { workerSetTimeout } from '../utils/workerTimer.js'
import {
  simulationSpeed,
  nivelarColasAlAbrir,
  oleadasRandom,
  oleadasLoop,
  MIN_TIME_EVENT,
  MAX_TIME_EVENT,
  MIN_CLIENTS_EVENT,
  MAX_CLIENTS_EVENT,
} from './simulacionConfig.js'
import { oleadas } from './oleadas.js'

/** El backend usa 'activa' para caja abierta y 'cerrada' para caja cerrada. */
const STATUS_ABIERTA = ['activa', 'abierta'] // añado 'Abierta' por si acaso.

class Simulacion {
  async inicializar() {
    this.cajas = []
    this._oleadaIndex = 0
    try {
      // getQueues incluye `length` (nº de clientes) calculado desde la última instantánea
      const queues = await getQueues()
      for (const q of queues) {
        const caja = new Caja(q.id, STATUS_ABIERTA.includes(q.status), q.length ?? 0)
        this.cajas.push(caja)
      }
      console.log(`[Simulacion] ${queues.length} cajas cargadas desde el backend`)
    } catch (error) {
      console.error('[Simulacion] Error al obtener el estado inicial:', error)
    }
    // Delay inicial para que los primeros clientes no lleguen inmediatamente al iniciar la simulación
    workerSetTimeout(() => this.eventoSimulacion(), 1000)
  }

  async refrescarEstadoCajas() {
    const cajas = await getCajas()
    let algunaCajaAbrio = false
    for (const c of cajas) {
      const caja = this.obtenerCaja(c.id)
      if (!caja) continue
      const estabaAbierta = caja.abierta
      caja.abierta = STATUS_ABIERTA.includes(c.estado)
      if (!estabaAbierta && caja.abierta) algunaCajaAbrio = true
      caja.sincronizarDependiente(caja.abierta)
    }
    if (algunaCajaAbrio && nivelarColasAlAbrir.value) this.nivelarColas()
  }

  obtenerCaja(numeroCaja) {
    return this.cajas.find((caja) => caja.id === numeroCaja)
  }

  agregarCliente(numeroCaja) {
    const caja = this.obtenerCaja(numeroCaja)
    if (!caja) return null
    return caja.agregarCliente()
  }

  removerCliente(numeroCaja) {
    const caja = this.obtenerCaja(numeroCaja)
    if (!caja) return null
    return caja.removerCliente()
  }

  async abrirCaja(numeroCaja) {
    const caja = this.obtenerCaja(numeroCaja)
    if (!caja) return null
    const resultado = await caja.abrirCaja()
    if (nivelarColasAlAbrir.value) this.nivelarColas()
    return resultado
  }

  async cerrarCaja(numeroCaja) {
    const caja = this.obtenerCaja(numeroCaja)
    if (!caja) return null
    return caja.cerrarCaja()
  }

  seleccionarCaja() {
    const cajasAbiertas = this.cajas.filter((caja) => caja.abierta)
    if (cajasAbiertas.length === 0) return null
    // Seleccionar la caja con menos clientes
    const cajaSeleccionada = cajasAbiertas.reduce((prev, curr) =>
      prev.cola.length < curr.cola.length ? prev : curr,
    )
    return cajaSeleccionada.id
  }

  /**
   * Redistribuye equitativamente los clientes en espera entre todas las cajas abiertas.
   *
   * Regla: el cliente en posición 0 de cada caja (ya siendo atendido) nunca se mueve.
   * El resto se recoge, se ordena por longitud de cola (más corta primero) y se reparte
   * en round-robin para minimizar la diferencia entre colas.
   *
   * Se llama automáticamente cuando una caja pasa de cerrada a abierta.
   */
  nivelarColas() {
    const cajasAbiertas = this.cajas.filter((c) => c.abierta)
    if (cajasAbiertas.length < 2) return

    // Extraer todos los clientes en espera (índice ≥ 1) de todas las cajas abiertas
    const enEspera = []
    for (const caja of cajasAbiertas) {
      if (caja.cola.length > 1) {
        enEspera.push(...caja.cola.splice(1))
      }
    }
    if (enEspera.length === 0) return

    // Priorizar las colas más cortas en el reparto (round-robin ordenado)
    const cajasOrdenadas = [...cajasAbiertas].sort((a, b) => a.cola.length - b.cola.length)

    for (let i = 0; i < enEspera.length; i++) {
      const caja = cajasOrdenadas[i % cajasOrdenadas.length]
      const eraVacia = caja.cola.length === 0
      caja.cola.push(enEspera[i])
      // Si la caja estaba vacía arrancamos la cadena de timeouts de atención
      if (eraVacia) caja.removeClienteTimeout()
    }

    console.log(
      '[Simulacion] Colas niveladas:',
      cajasAbiertas.map((c) => `Caja ${c.id}: ${c.cola.length}`).join(', '),
    )
  }

  eventoSimulacion() {
    if (oleadasRandom.value) {
      this._eventoAleatorio()
    } else {
      this._eventoOleada()
    }
  }

  _eventoAleatorio() {
    const n_clientes =
      Math.floor(Math.random() * (MAX_CLIENTS_EVENT - MIN_CLIENTS_EVENT + 1)) + MIN_CLIENTS_EVENT
    const tiempo_evento =
      Math.floor(Math.random() * (MAX_TIME_EVENT - MIN_TIME_EVENT + 1)) + MIN_TIME_EVENT
    console.log('Evento de simulación aleatorio', { n_clientes, tiempo_evento })

    for (let i = 0; i < n_clientes; i++) {
      const numeroCaja = this.seleccionarCaja()
      if (numeroCaja !== null) {
        const c = this.agregarCliente(numeroCaja)
        console.log(
          `Cliente agregado a la caja ${numeroCaja} con tiempo en caja de ${c.tiempoEnCaja} segundos`,
        )
      }
    }

    workerSetTimeout(
      () => {
        this.eventoSimulacion()
      },
      (tiempo_evento * 1000) / simulationSpeed.value,
    )
  }

  _eventoOleada() {
    if (oleadas.length === 0) return

    const oleada = oleadas[this._oleadaIndex % oleadas.length]
    console.log(`Evento de simulación — oleada ${this._oleadaIndex + 1}:`, oleada)

    for (let i = 0; i < oleada.clientes; i++) {
      const numeroCaja = this.seleccionarCaja()
      if (numeroCaja !== null) {
        const c = this.agregarCliente(numeroCaja)
        if (c) console.log(`[Oleada] Cliente agregado a caja ${numeroCaja} (${c.tiempoEnCaja}s)`)
      }
    }

    this._oleadaIndex++
    if (this._oleadaIndex >= oleadas.length) {
      if (!oleadasLoop.value) {
        console.log('[Simulacion] Ciclo de oleadas completado. No se reinicia.')
        return
      }
      console.log('[Simulacion] Ciclo de oleadas completado. Reiniciando desde la primera oleada.')
      this._oleadaIndex = 0
    }

    workerSetTimeout(
      () => {
        this.eventoSimulacion()
      },
      (oleada.delay * 1000) / simulationSpeed.value,
    )
  }
}

export default Simulacion
