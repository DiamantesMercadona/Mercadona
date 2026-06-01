/** Array de oleadas de clientes.
 * Cada oleada es un objeto con:
 * - `clientes`: número de clientes que llegan en la oleada. Cada uno se asigna
 *   automáticamente a la caja abierta con menos cola.
 * - `delay`: segundos hasta la siguiente oleada (afectado por el factor de velocidad).
 */
export const oleadas = [
  // Apertura — llegada gradual
  { clientes: 0, delay: 15 },
  { clientes: 1, delay: 7 },
  { clientes: 2, delay: 6 },
  { clientes: 2, delay: 6 },
  // Incremento progresivo
  { clientes: 3, delay: 5 },
  { clientes: 3, delay: 5 },
  // Hora punta — colas largas, se abren nuevas cajas
  { clientes: 7, delay: 4 },
  // Bajada progresiva
  { clientes: 3, delay: 6 },
  { clientes: 2, delay: 6 },
  { clientes: 1, delay: 7 },
  { clientes: 0, delay: 8 },
]
