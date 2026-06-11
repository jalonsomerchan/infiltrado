# Cambios de jugabilidad

- Las partidas siguen siendo infinitas dentro de la misma sala.
- Al terminar una partida, el admin pulsa **Continuar Partida** y se genera otra partida con nuevas palabras y otro infiltrado cuando sea posible.
- Durante cada ronda se muestra a todos quién tiene que hablar.
- El admin avanza manualmente con **Continuar**. Al llegar al último jugador vivo, el botón pasa a **Ir a votación**.
- En cada votación se elimina al jugador más votado.
- La partida no termina por límite de rondas: continúa hasta capturar al último infiltrado.
- Si ya no quedan civiles, ganan los infiltrados.
- Arriba se muestra si eres **Civil** o **Infiltrado**.
- Si te eliminan aparece una animación grande de **ELIMINADO**.
- Si te pillan siendo infiltrado aparece una animación de **CAPTURADO**.

# Ficheros modificados

- `index.html`
- `js/game.js`

# Notas

Se mantiene el backend actual:

- `POST /rooms`
- `POST /rooms/{code}/join`
- `GET /rooms/{code}`
- `PATCH /rooms/{code}/state`

No se usa `/actions`, no se usa `wss://alon.one/...` y no se añaden headers CORS problemáticos.
