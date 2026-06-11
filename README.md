# Fix CORS para crear salas

Este paquete corrige `js/GameAPI.js`.

El problema era que se añadieron headers anti-cache a todas las peticiones:

- `X-Requested-With`
- `Cache-Control`
- `Pragma`

En peticiones CORS esos headers disparan un preflight `OPTIONS`. Si la API no responde correctamente al preflight, el navegador cancela el `POST /rooms` con `net::ERR_FAILED`.

La corrección deja `POST` y `PATCH` sin headers extra. Solo los `GET` mantienen cache buster por query string y `cache: 'no-store'`, que no rompe CORS.
