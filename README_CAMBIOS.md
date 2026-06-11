# Cambios incluidos

- El admin conserva los controles aunque haya sido eliminado.
- Nueva opción **Orden aleatorio** al crear sala.
  - Si está activada, el orden de descripción se mezcla después de cada votación.
  - Si está desactivada, se mantiene el orden de la partida quitando eliminados.
- En modo **Infiltrado ciego** se oculta la etiqueta superior de Civil/Infiltrado.
- El QR del lobby se puede pulsar para verlo grande en un modal.
- Eliminada la frase repetida tipo “Ahora habla X” de la zona inferior.
- El bloque **Orden de descripción** aparece justo debajo de “Ahora le toca a X”.
- El admin también conserva la etiqueta de Civil/Infiltrado cuando el modo no es ciego.

No se han añadido endpoints nuevos, no se usa `wss://alon.one/...` y no se han añadido cabeceras que rompan CORS.
