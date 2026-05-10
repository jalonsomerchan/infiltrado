/**
 * Librería para interactuar con la API de juegos de alon.one
 */
export default class GameAPI {
  constructor(baseURL = 'https://alon.one/juegos/api') {
    this.baseURL = baseURL.replace(/\/$/, ''); // Limpiar slash final si existe
  }

  /**
   * Helper privado para peticiones HTTP
   */
  async _request(endpoint, method = 'GET', data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseURL}/${endpoint}`, options);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || `Error: ${response.status}`);
      }
      return result;
    } catch (error) {
      console.error(`API Error (${method} ${endpoint}):`, error);
      throw error;
    }
  }

  // --- MÉTODOS DE USUARIO ---

  /** Crea un nuevo usuario y devuelve su UUID */
  async createUser(username, password, email = '') {
    return this._request('users', 'POST', { username, password, email });
  }

  // --- MÉTODOS DE JUEGO (ADMIN/CONFIG) ---

  /** Registra un nuevo tipo de juego en la base de datos */
  async createGame(name, maxPlayers, defaultConfig = {}) {
    return this._request('games', 'POST', {
      name,
      max_players_per_room: maxPlayers,
      default_config: defaultConfig
    });
  }

  // --- MÉTODOS DE SALA (ROOMS) ---

  /** Crea una sala nueva. El host se une automáticamente. */
  async createRoom(gameId, hostId, roomSettings = {}, initialState = { status: 'waiting' }) {
    return this._request('rooms', 'POST', {
      game_id: gameId,
      host_id: hostId,
      room_settings: roomSettings,
      game_state: initialState
    });
  }

  /** Obtiene la información completa de una sala mediante su código (ej: A6K9P2) */
  async getRoom(roomCode) {
    return this._request(`rooms/${roomCode}`, 'GET');
  }

  /** Une a un usuario a una sala existente */
  async joinRoom(roomCode, userId) {
    return this._request(`rooms/${roomCode}/join`, 'POST', { user_id: userId });
  }

  /**
   * Envía una acción de juego para que el servidor valide permisos y genere el nuevo estado.
   *
   * Endpoint recomendado para cerrar la vulnerabilidad de la issue #8:
   * el cliente pide "qué quiere hacer" y el backend decide si puede hacerlo.
   */
  async sendRoomAction(roomCode, action, actorId, payload = {}, expectedStateVersion = null) {
    const body = {
      action,
      actor_id: actorId,
      payload
    };

    if (expectedStateVersion !== null) {
      body.expected_state_version = expectedStateVersion;
    }

    return this._request(`rooms/${roomCode}/actions`, 'POST', body);
  }

  /**
   * @deprecated Evitar usar este método para acciones de juego públicas.
   *
   * Este endpoint permite enviar parches completos de estado desde cliente y solo es seguro
   * si el backend valida permisos, campos permitidos y recalcula ganador/eliminados/puntos.
   * Para producción, usar sendRoomAction() con acciones como start_game, start_voting,
   * cast_vote o back_to_lobby.
   */
  async updateRoomState(roomCode, { gameState, status, roomSettings }) {
    const payload = {};
    if (gameState) payload.game_state = gameState;
    if (status) payload.status = status;
    if (roomSettings) payload.room_settings = roomSettings;
    
    return this._request(`rooms/${roomCode}/state`, 'PATCH', payload);
  }

  // --- MÉTODOS DE PUNTUACIÓN (SCORES) ---

  /** Guarda una puntuación al finalizar una partida */
  async saveScore(userId, gameId, scoreValue, roomId = null, metadata = {}) {
    return this._request('scores', 'POST', {
      user_id: userId,
      game_id: gameId,
      room_id: roomId,
      score_value: scoreValue,
      metadata: metadata
    });
  }
}
