import { ref } from 'vue'

//  Velocidad global

/** Factor de velocidad de la simulación (slider hasta 20x).
 *  Los timeouts que ya se han programado no se ven afectados, pero los nuevos sí.
 */
export const simulationSpeed = ref(1)

//  Comportamiento de colas

/** Si es true, al abrir una caja los clientes en espera se redistribuyen equitativamente. */
export const nivelarColasAlAbrir = ref(true)

export const oleadasRandom = ref(false)

/** Si es true, el ciclo de oleadas predefinidas se reinicia al llegar al final del array. */
export const oleadasLoop = ref(false)

//  Oleadas de llegada

/** Segundos entre cada oleada de nuevos clientes. */
export const MIN_TIME_EVENT = 60
export const MAX_TIME_EVENT = 120

/** Clientes que llegan por oleada. */
export const MIN_CLIENTS_EVENT = 1
export const MAX_CLIENTS_EVENT = 4

//  Tiempo de servicio en caja

/** Cesta pequeña (sin carrito): 2–4 min. */
export const MIN_TIME_CAJA = 12
export const MAX_TIME_CAJA = 12

/** Carrito completo: 5–10 min. */
export const MIN_TIME_CAJA_CARRITO = 300
export const MAX_TIME_CAJA_CARRITO = 600

export const PROBABILIDAD_CARRITO = 0

//  Velocidades de animación 3D (fracción de recorrido por frame; menor = más lento)

export const ANIM_SPEED_COLA = 0.022
export const ANIM_SPEED_REUBICACION = 0.012
