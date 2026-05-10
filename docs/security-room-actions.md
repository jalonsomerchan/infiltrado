# Seguridad de acciones de sala

La issue #8 no puede resolverse completamente solo desde este repositorio porque la aplicación es frontend estático y el estado se actualiza contra `https://alon.one/juegos/api`. Cualquier validación que viva únicamente en `js/game.js` puede saltarse desde la consola del navegador.

Para cerrar la vulnerabilidad en producción, el backend de `alon.one/juegos/api` debe dejar de aceptar parches arbitrarios del estado completo desde clientes no autenticados y exponer acciones validadas por servidor.

## Problema actual

El endpoint actual permite enviar estado completo:

```http
PATCH /rooms/{roomCode}/state
```

Con payloads como:

```json
{
  "status": "results",
  "game_state": {
    "winner": "infiltrado"
  }
}
```

Aunque el frontend oculte botones, cualquier jugador podría ejecutar llamadas equivalentes desde la consola si el servidor no valida permisos.

## Contrato recomendado

Crear un endpoint de acciones:

```http
POST /rooms/{roomCode}/actions
```

Payload base:

```json
{
  "action": "start_game",
  "actor_id": "uuid-del-jugador",
  "payload": {}
}
```

El servidor debe reconstruir el nuevo estado usando el estado actual guardado en base de datos. No debe confiar en `game_state` calculado por el cliente.

## Acciones permitidas

### `start_game`

Solo host.

Validaciones:

- `actor_id === room.host_id`.
- `room.status === "waiting"`.
- mínimo 3 jugadores.
- si `room_settings.mode === "double"`, mínimo 6 jugadores.

El servidor debe generar:

- infiltrado(s),
- palabras,
- orden de turno,
- ronda,
- votos vacíos,
- `winner: null`,
- `roundStartedAt`.

### `start_voting`

Solo host.

Validaciones:

- `actor_id === room.host_id`.
- `room.status === "playing"`.
- el host no está eliminado.

El servidor cambia:

```json
{
  "status": "voting",
  "game_state.votes": {}
}
```

### `cast_vote`

Cualquier jugador vivo.

Payload:

```json
{
  "target_id": "uuid-del-jugador-votado"
}
```

Validaciones:

- `room.status === "voting"`.
- el actor existe en `game_state.players`.
- el actor no está eliminado.
- el actor no ha votado ya.
- `target_id` existe.
- `target_id !== actor_id`.
- `target_id` no está eliminado.

El servidor debe:

- registrar el voto,
- si votaron todos los jugadores vivos, calcular eliminado,
- calcular ganador con la lógica de infiltrados/civiles,
- actualizar puntos,
- cambiar `status` a `playing` o `results`.

### `back_to_lobby`

Solo host.

Validaciones:

- `actor_id === room.host_id`.
- `room.status` en `playing`, `voting` o `results`.

El servidor cambia:

```json
{
  "status": "waiting"
}
```

## Control de concurrencia

Para evitar condiciones de carrera, añadir versión al estado:

```json
{
  "state_version": 12
}
```

Cada acción debe enviar la versión conocida:

```json
{
  "action": "cast_vote",
  "actor_id": "...",
  "expected_state_version": 12,
  "payload": { "target_id": "..." }
}
```

El backend debe rechazar si `expected_state_version !== room.state_version` con `409 Conflict`.

## Respuesta recomendada

```json
{
  "room_code": "ABC123",
  "status": "voting",
  "room_settings": {},
  "game_state": {},
  "state_version": 13
}
```

## Endurecimiento mínimo si se mantiene `PATCH /state`

Si no se puede crear `/actions` todavía, el backend debe validar `PATCH /rooms/{roomCode}/state` con estas reglas mínimas:

- Solo host puede cambiar `status`, `room_settings`, `players`, `winner`, `turnOrder`, `round` o palabras.
- Un jugador no host solo puede añadir/modificar `votes[actor_id]` y únicamente en estado `voting`.
- El servidor debe ignorar campos no permitidos según rol y estado.
- El servidor debe recalcular ganador, eliminados y puntos; nunca aceptar esos valores del cliente.

## Checklist para cerrar seguridad real

- [ ] Reemplazar mutaciones críticas desde frontend por `POST /rooms/{roomCode}/actions`.
- [ ] Validar host en backend.
- [ ] Validar jugador vivo y voto único en backend.
- [ ] Recalcular infiltrados, eliminados, ganador y puntos en backend.
- [ ] Añadir `state_version` o transacciones para evitar votos simultáneos corruptos.
- [ ] Mantener `PATCH /state` solo para operaciones administrativas o eliminarlo del cliente público.
