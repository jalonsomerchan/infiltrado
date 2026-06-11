# Cambios incluidos

## Sincronización de sala

- Se mantiene `itty-sockets` desde `https://esm.sh/itty-sockets`.
- Se eliminan rutas WebSocket inventadas: no hay `wss://alon.one/...`.
- Cada cambio de estado emite eventos ligeros por IttySockets (`state_updated`, `room_changed`, `player_joined`).
- Los clientes que reciben eventos hacen una reconciliación real con `GET /rooms/{code}` para evitar estados parciales.
- Se añade refresco de respaldo cada 1s dentro de la sala para que el lobby, el inicio de partida, la palabra y la votación se actualicen aunque IttySockets no entregue algún evento.

## Caché

- `GameAPI` ahora usa `cache: 'no-store'`, cabeceras no-cache y cache buster en los `GET`.
- Esto evita que `GET /rooms/{code}` devuelva un estado antiguo y obligue a refrescar la página manualmente.

## Flujo de juego

- Antes de comenzar partida o abrir votación, el admin refresca la sala para no operar con jugadores/estado antiguo.
- Los cambios de estado también se guardan dentro de `game_state.status`, además del `status` principal, para tolerar backends que devuelvan el estado de una u otra forma.
- Se normalizan respuestas envueltas tipo `{ room }` o `{ data: { room } }`.
- Se normaliza el código de sala en mayúsculas para que no se corte la sincronización por diferencias de formato.

## Otros arreglos conservados

- Corrección de estilos `@apply` para Tailwind por CDN.
- Control de rondas máximas.
- Corrección de `Hamburgesa` a `Hamburguesa`.
- Reconexión de socket más segura.


## Cambio: partidas infinitas en la misma sala

- El botón final ahora muestra `Continuar Partida`.
- Al pulsarlo el administrador no crea una sala nueva.
- Se reutiliza la misma sala y se genera una nueva partida con otro infiltrado, nuevas palabras y jugadores sin eliminar.
- La puntuación acumulada de los jugadores se conserva entre partidas.
- Los jugadores no administradores ven un mensaje de espera hasta que el administrador continúa.
