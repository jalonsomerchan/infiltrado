# Cambios aplicados

## Compatibilidad con el backend real

- Se usa el endpoint existente `PATCH /rooms/{code}/state`.
- No se llama a el endpoint de acciones inexistente porque no existe en el backend actual.
- Se evita cualquier URL una URL WebSocket propia de alon.one, porque ese endpoint tampoco existe.

## IttySockets

- `js/game.js` mantiene la importación oficial del proyecto:
  `import { connect } from 'https://esm.sh/itty-sockets';`
- La conexión ahora usa un canal de sala de IttySockets:
  `infiltrado:room:{CODIGO}`
- Al actualizar el estado con la API REST, el cliente emite `state_updated` por IttySockets para que el resto de jugadores refresquen la UI sin polling.
- El listener acepta tanto eventos nombrados (`state_updated`) como mensajes genéricos (`message`) para ser más tolerante con el formato que entregue `itty-sockets`.

## Correcciones de juego/UI

- Sustituido `@apply` por CSS real compatible con Tailwind vía CDN.
- Corregido `Hamburgesa` → `Hamburguesa`.
- Añadido bloqueo de doble voto desde UI.
- Antes de votar se refresca la sala para reducir votos pisados.
- Añadido control real de rondas máximas.
- Al terminar y volver al lobby se crea una sala nueva con el mismo host, como indica `agents.md`.
- Mejorada la reconexión del socket para no dejar temporizadores o sesiones antiguas activos.

## Seguridad pendiente de backend

El frontend ya no inventa endpoints, pero la vulnerabilidad de manipulación completa no se puede cerrar del todo solo con JS mientras el backend acepte parches completos de `game_state` desde cualquier cliente. La protección real requiere validar permisos y campos permitidos en `PATCH /rooms/{code}/state`, especialmente `players`, `votes`, `winner`, `status` y `room_settings`.
