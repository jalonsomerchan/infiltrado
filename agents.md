# Claude.md: Guía de Proyecto - Democrazy

Este documento detalla el plan de diseño, arquitectura e implementación para un juego web de tipo **Single Page Application (SPA)** que utiliza una API específica para la gestión de usuarios, salas y puntuaciones, estilizado con Tailwind CSS.

---

## 1. Visión General del Proyecto

### Objetivo
Desarrollar un prototipo de juego web multijugador básico o de puntuación que interactúe con el backend en `https://alon.one/juegos/api`.

### Características Clave
* **One Single Page (SPA)**: Toda la navegación y el juego ocurren en un solo archivo HTML, gestionado por JavaScript.
* **Integración de API**: Uso de la librería `GameAPI.js` para comunicarse con el backend.
* **Estilo Moderno**: Uso de Tailwind CSS para una interfaz de usuario rápida y receptiva.
* **Separación de Preocupaciones**: Ficheros separados para HTML, CSS, JavaScript (Lógica y API).

---

## 2. Pila Tecnológica

| Componente | Tecnología | Uso |
| :--- | :--- | :--- |
| **Frontend** | HTML5 | Estructura del documento único. |
| **Estilos** | Tailwind CSS | Diseño visual responsive y moderno (vía CDN o CLI). |
| **Lógica** | JavaScript (ES6+) | Gestión de estado, DOM y lógica del juego. |
| **API** | `GameAPI.js` (Fetch) | Librería JS para consumo del backend PHP. |
| **Backend** | PHP/MariaDB | API REST provista. |


---

## 3. Flujo de Salas (Lobby)
La pantalla inicial tras el login permitirá dos acciones principales:

### A. Crear Sala (Rol: Administrador/Host)
* **Acción:** Ejecuta `POST /rooms`.
* **Privilegios:** * Es el único que visualiza y puede pulsar el botón **"Comenzar Juego"**.
    * Puede modificar los `room_settings` (ej: dificultad, tiempo) antes de empezar.
* **Transición:** Al pulsar "Comenzar", ejecuta un `PATCH` al estado de la sala cambiando el `status` a `"playing"`.

### B. Unirse a Sala (Rol: Jugador/Invitado)
* **Acción:** Introduce un código y ejecuta `POST /rooms/{code}/join`.
* **Restricciones:** * No tiene permisos para modificar la configuración.
    * Visualiza un mensaje de espera: *"Esperando a que el administrador inicie la partida..."*.


La informacion del jugador se guadará en el localstorage para reutilizar el usuario, auqnue podrá crear uno nuevo.

Después de cada partida se creará una nueva sala, con el mismo administrador y pasarán al lobby para iniciar una nueva partida.

La actualización de jugadores y del estado de la sala se realizará mediante WebSockets (IttySockets) en lugar de polling.

Las salas se podrán compartir mediante enlace (copiando el enlace o con webshare api) o mediante un QR.

---

## 4. Implementación de IttySockets

Para este proyecto, el uso de IttySockets se centrará en:

Actualización de Jugadores: Notificar cuando alguien entra o sale de la sala de espera.

Inicio de Partida: Sincronizar el salto de la pantalla de lobby a la de juego para todos los usuarios simultáneamente.

Chat/Acciones: Enviar mensajes rápidos o pequeñas acciones de juego.

---

## 4. Funcionamiento del juego

El juego del infiltrado. Un jugador será el infiltrado, y los demás no. Los jugadores no infiltrados recibirán una palabra (definida en palabra.js). En cada ronda (el administador marca cuando) se votará por una persona. Si se vota al que mas a un no infiltrado, se elimina de la partida y se continua jugando. Si se vota al que mas infiltrado, se termina la partida.

Ademas el juego elige el orden en que los participantes tienen que decir una palabra relacionada con la palabra. 

El administrador puede configurar: que el infiltrado reciba otra palabra, sin saber que es el infiltrado, o no reciba ninguna palabra. Que el infiltrado reciba la categoria de la palabra, o no reciba nada, el numero de turnos.

---

## 5. Arquitectura de Ficheros

El proyecto debe mantener una estructura limpia para facilitar el mantenimiento y la escalabilidad.

# Reglas de Eficiencia - JS/HTML
- **Respuestas:** Solo código modificado. No reescribas archivos enteros.
- **Estilo:** ES6+, vanilla JS (sin frameworks a menos que lo pida).
- **HTML:** Usa nombres de clases semánticos.
- **Prohibido:** No des explicaciones teóricas ni introducciones ("Aquí tienes el código..."). Ve al grano.
