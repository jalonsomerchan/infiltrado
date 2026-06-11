# Cambios incluidos

## Flujo de turnos
- Se muestra a todos quién tiene que hablar.
- El admin ve el mismo aviso de turno que el resto.
- El admin tiene siempre el botón **Continuar** durante la fase de palabra.
- Cuando llega el último jugador vivo, el botón pasa a **Ir a votación**.
- Al jugador que tiene que hablar se le muestra una animación grande de **¡TE TOCA!**.

## Rol visible
- Arriba se muestra si eres **CIVIL** o **INFILTRADO**.
- También se muestra al admin, porque el admin es un jugador más.
- Se elimina el `mode-status` de la pantalla de partida.

## Votación
- Nueva opción al crear sala: **Voto secreto**.
- Si el voto secreto está desactivado, al resolverse la votación se muestra quién ha votado a quién.
- Se guarda historial de votación por ronda.
- Nuevo botón **Estadísticas de votación** para consultar rondas anteriores.

## Eliminación y victoria
- En cada ronda se elimina el jugador más votado.
- Si se captura a un infiltrado, solo termina la partida cuando ya no queda ningún infiltrado vivo.
- Si los infiltrados vivos igualan o superan a los civiles vivos, ganan los infiltrados. Esto cubre el caso de que queden todos infiltrados menos un civil.
- Se mantienen las animaciones de **ELIMINADO** y **CAPTURADO**.

## Compatibilidad
- No se usa `/actions`.
- No se usa `wss://alon.one/...`.
- No se añaden headers CORS problemáticos.
- Se mantiene `PATCH /rooms/{code}/state` y `https://esm.sh/itty-sockets`.
