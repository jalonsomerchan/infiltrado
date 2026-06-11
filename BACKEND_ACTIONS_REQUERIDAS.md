# Acciones que debe validar el backend

Endpoint usado por el frontend:

```http
POST /rooms/{roomCode}/actions
```

Cuerpo común:

```json
{
  "action": "start_game",
  "actor_id": "uuid-del-jugador",
  "payload": {},
  "expected_state_version": 1
}
```

## upsert_player

Usada tras `joinRoom()` para sincronizar el jugador dentro de `game_state.players`.

Validaciones recomendadas:

- `actor_id` debe coincidir con `payload.player.id`.
- La sala debe existir.
- La sala debe estar en `waiting` para permitir altas nuevas normales.
- No permitir nombres duplicados.

## start_game

Validaciones recomendadas:

- Solo `host_id` puede ejecutar la acción.
- La sala debe estar en `waiting`.
- Mínimo 3 jugadores.
- Modo `double`: mínimo 6 jugadores.
- El servidor debería elegir palabras/infiltrados y no fiarse del `proposedState` recibido.

## start_voting

Validaciones recomendadas:

- Solo `host_id` puede ejecutar la acción.
- La sala debe estar en `playing`.
- Resetear `votes` en servidor y pasar `status` a `voting`.

## cast_vote

Validaciones recomendadas:

- La sala debe estar en `voting`.
- El votante debe estar vivo y pertenecer a la sala.
- El votante solo puede votar una vez por ronda.
- El objetivo debe estar vivo y no ser el propio votante.
- El servidor debe contar votos de forma atómica.
- Al terminar todos los votos, el servidor debe resolver empate, eliminado, ganador, puntos y límite de rondas.

## back_to_lobby

Validaciones recomendadas:

- Solo `host_id` puede ejecutar la acción.
- Tras resultados, crear una sala nueva con el mismo host, mismos ajustes y jugadores reseteados.
- Devolver `room` o `new_room_code` para que el frontend navegue a la nueva sala.
