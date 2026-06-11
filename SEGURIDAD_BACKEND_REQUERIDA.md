# Seguridad pendiente en backend

No se debe añadir en frontend una llamada a el endpoint de acciones inexistente mientras el backend no tenga ese endpoint.

La versión corregida mantiene el endpoint real disponible:

```http
PATCH /rooms/{code}/state
```

y usa IttySockets desde:

```js
import { connect } from 'https://esm.sh/itty-sockets';
```

con canales de sala tipo:

```js
connect(`infiltrado:room:${code}`)
```

No debe usarse una URL WebSocket propia de alon.one porque no existe.

Para cerrar completamente la issue de seguridad, el backend debe validar en `PATCH /rooms/{code}/state`:

- que solo el host pueda cambiar `status`, comenzar partida, iniciar votación o crear una nueva ronda;
- que cada jugador solo pueda registrar su propio voto;
- que un jugador eliminado no pueda votar;
- que `players`, `winner`, `round` y puntos no puedan ser manipulados libremente desde cliente;
- que los resultados se calculen en servidor o, como mínimo, se rechacen cambios incoherentes.
