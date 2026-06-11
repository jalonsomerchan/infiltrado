# Cambios aplicados

## Sincronización de sala

- Se mantiene el uso de `https://esm.sh/itty-sockets`.
- Se elimina cualquier dependencia de endpoints WebSocket propios.
- Se abre el canal IttySockets en cuanto el jugador entra en la sala, antes de modificar el estado compartido.
- Al unirse un jugador se emite `player_joined` y, al cambiar el estado, se emiten `state_updated` y `room_changed`.
- El wrapper de IttySockets ahora soporta varias formas de API: `send`, `emit`, `publish`, `on`, `addEventListener` y propiedades `onmessage`/`onclose`.
- Se añade una reconciliación automática cada 2 segundos mientras se está dentro de una sala para evitar que la partida se quede congelada si el socket no entrega algún evento.
- La reconciliación solo repinta la UI cuando el estado recibido cambia, para no reanimar la pantalla constantemente.

## Correcciones anteriores conservadas

- Eliminado `@apply` no compilable con Tailwind CDN.
- Corregida la palabra `Hamburgesa` a `Hamburguesa`.
- Se respeta el límite de rondas configurado.
- Se evita doble envío de voto desde la UI.
- Se refresca el estado antes de votar para reducir votos pisados.
- Se limpia mejor la reconexión al salir de sala.
- Se crea una nueva sala para revancha desde resultados.

## Nota de seguridad

El frontend ya no usa endpoints inventados, pero la seguridad completa contra manipulación del estado solo se puede cerrar en backend. Mientras exista `PATCH /rooms/{code}/state` aceptando parches completos desde cualquier cliente, un usuario avanzado podrá manipular la partida desde las herramientas del navegador.
