import { connect } from 'https://esm.sh/itty-sockets';
import GameAPI from './GameAPI.js';
import palabras from './palabras.js';
import { GAME_MODES, createRoundState, getModeDescription, getModeLabel } from './gameModes.js';

const api = new GameAPI();
const GAME_ID = 12;
const MIN_PLAYERS = 3;
const USER_STORAGE_KEY = 'infiltrado_user';
const ROOM_STORAGE_KEY = 'infiltrado_room';
const SOCKET_RECONNECT_BASE_MS = 1000;
const SOCKET_RECONNECT_MAX_MS = 10000;
const ROOM_SYNC_FALLBACK_MS = 1000;
const HOME_VIEW = 'inicio';

let currentUser = JSON.parse(localStorage.getItem(USER_STORAGE_KEY)) || null;
let currentRoom = null;
let socket = null;
let socketRoomCode = null;
let socketSessionId = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
let roomSyncTimer = null;
let refreshPromise = null;
let lastRenderedRoomSignature = '';
let voteSubmitting = false;
let audioContext = null;
let timerInterval = null;
let timerExpiredNotified = false;
let lastEliminationNoticeKey = '';
let lastTurnNoticeKey = '';
let currentView = HOME_VIEW;
let urlRoomCode = new URLSearchParams(window.location.search).get('room');

const screens = {
  login: document.getElementById('screen-login'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results')
};

async function init() {
  setupExitButtons();
  setupEventListeners();
  setupHistoryNavigation();
  updateModeConfigUI();

  const route = getCurrentRoute();
  const savedRoomCode = localStorage.getItem(ROOM_STORAGE_KEY);
  const initialRoomCode = route.roomCode || urlRoomCode || savedRoomCode;

  if (currentUser) document.getElementById('login-username').value = currentUser.username;

  if (route.view === 'crear') {
    showLoginSubscreen('config', { replaceRoute: true });
    return;
  }

  if (route.view === 'unirse') {
    showLoginSubscreen('join', { replaceRoute: true, roomCode: initialRoomCode });
    return;
  }

  if (initialRoomCode && currentUser) {
    await joinRoom(initialRoomCode, { silent: true, replaceRoute: true });
    return;
  }

  resetHomeUI();
  setRoute(HOME_VIEW, { replace: true });
  showScreen('login');
}

function setupExitButtons() {
  addExitButton({ parent: document.getElementById('join-container'), id: 'btn-back-from-join', label: 'Volver al inicio', onClick: goHome });
  addExitButton({ parent: document.getElementById('config-container'), id: 'btn-cancel-config', label: 'Volver al inicio', onClick: goHome });
  addExitButton({ parent: document.getElementById('screen-lobby'), id: 'btn-leave-lobby', label: 'Salir de la sala', onClick: leaveRoomAndGoHome });
  addExitButton({ parent: document.getElementById('screen-game'), id: 'btn-leave-game', label: 'Salir de la partida', onClick: () => leaveRoomAndGoHome({ askConfirmation: true }) });
  addExitButton({ parent: document.getElementById('screen-results'), id: 'btn-leave-results', label: 'Salir al inicio', onClick: leaveRoomAndGoHome });
}

function addExitButton({ parent, id, label, onClick }) {
  if (!parent || document.getElementById(id)) return;

  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'w-full bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 rounded-2xl p-3 text-sm font-black uppercase tracking-widest transition-all';
  button.innerText = label;
  button.onclick = onClick;
  parent.appendChild(button);
}

function setupEventListeners() {
  document.getElementById('btn-create-init').onclick = () => {
    feedback('click');
    if (!validateUser()) return;
    showLoginSubscreen('config');
  };
  document.getElementById('btn-join-init').onclick = () => {
    feedback('click');
    if (!validateUser()) return;
    showLoginSubscreen('join');
  };
  document.getElementById('config-mode').onchange = updateModeConfigUI;
  document.getElementById('btn-create-confirm').onclick = createRoom;
  document.getElementById('btn-join-confirm').onclick = () => {
    feedback('click');
    if (!validateUser()) return;
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (code) joinRoom(code);
  };
  document.getElementById('btn-start').onclick = startGame;
  document.getElementById('btn-show-voting').onclick = advanceTurn;
  document.getElementById('btn-back-lobby').onclick = continueGame;
  document.getElementById('btn-share').onclick = shareRoom;
  document.getElementById('btn-whatsapp').onclick = shareRoomOnWhatsApp;
  document.getElementById('btn-copy-code').onclick = copyRoomCode;
  document.getElementById('btn-copy-link').onclick = copyRoomLink;
  document.getElementById('btn-vote-stats').onclick = showVoteStats;
  document.getElementById('btn-close-vote-stats').onclick = hideVoteStats;
  document.getElementById('vote-stats-modal').onclick = (event) => {
    if (event.target.id === 'vote-stats-modal') hideVoteStats();
  };
  document.getElementById('room-qr').onclick = showQrModal;
  document.getElementById('btn-close-qr-modal').onclick = hideQrModal;
  document.getElementById('qr-modal').onclick = (event) => {
    if (event.target.id === 'qr-modal') hideQrModal();
  };
}

function setupHistoryNavigation() {
  window.addEventListener('popstate', () => handleRouteChange(getCurrentRoute()));
}

function getCurrentRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view') || (params.get('room') ? 'unirse' : HOME_VIEW),
    roomCode: params.get('room')
  };
}

function setRoute(view, { roomCode = currentRoom?.room_code, replace = false } = {}) {
  currentView = view;
  const params = new URLSearchParams();

  if (roomCode && view !== HOME_VIEW && view !== 'crear') params.set('room', roomCode);
  if (view !== HOME_VIEW) params.set('view', view);

  const query = params.toString();
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  const method = replace ? 'replaceState' : 'pushState';

  if (`${window.location.pathname}${window.location.search}` !== url) {
    window.history[method]({ view, roomCode }, '', url);
  } else if (replace) {
    window.history.replaceState({ view, roomCode }, '', url);
  }
}

async function handleRouteChange({ view, roomCode }) {
  currentView = view;

  if (view === HOME_VIEW) {
    leaveRoomAndGoHome({ skipRoute: true });
    return;
  }

  if (view === 'crear') {
    closeSocket();
    currentRoom = null;
    showLoginSubscreen('config', { skipRoute: true });
    return;
  }

  if (view === 'unirse') {
    closeSocket();
    currentRoom = null;
    showLoginSubscreen('join', { skipRoute: true, roomCode });
    return;
  }

  if (roomCode && (!currentRoom || currentRoom.room_code !== roomCode)) {
    if (currentUser) await joinRoom(roomCode, { silent: true, replaceRoute: true });
    else showLoginSubscreen('join', { skipRoute: true, roomCode });
    return;
  }

  if (!currentRoom) {
    goHome({ skipRoute: true });
    return;
  }

  if (view === 'sala') { renderLobby(); showScreen('lobby'); return; }
  if (view === 'partida') { renderGame(); showScreen('game'); return; }
  if (view === 'votacion') { renderVoting(); showScreen('game'); return; }
  if (view === 'ronda') { renderRoundResults(); showScreen('game'); return; }
  if (view === 'resultados') { renderResults(); showScreen('results'); return; }

  goHome({ skipRoute: true });
}

function routeForStatus(status) {
  if (status === 'waiting') return 'sala';
  if (status === 'playing') return 'partida';
  if (status === 'voting') return 'votacion';
  if (status === 'round_results') return 'ronda';
  if (status === 'results') return 'resultados';
  return HOME_VIEW;
}

function showLoginSubscreen(type, { replaceRoute = false, skipRoute = false, roomCode = '' } = {}) {
  document.getElementById('login-actions').classList.add('hidden');
  document.getElementById('config-container').classList.toggle('hidden', type !== 'config');
  document.getElementById('join-container').classList.toggle('hidden', type !== 'join');

  if (type === 'join') document.getElementById('join-code').value = roomCode || '';
  if (!skipRoute) setRoute(type === 'config' ? 'crear' : 'unirse', { roomCode, replace: replaceRoute });
  showScreen('login');
}

function updateModeConfigUI() {
  const mode = document.getElementById('config-mode').value;
  const modeDescription = document.getElementById('mode-description');
  const timerConfig = document.getElementById('timer-config');
  const infiltradoWordConfig = document.getElementById('config-infiltrado-word').closest('.flex');

  modeDescription.innerText = getModeDescription(mode);
  timerConfig.classList.toggle('hidden', mode !== 'timed');
  infiltradoWordConfig.classList.toggle('hidden', mode === 'blind' || mode === 'chaos');
}

function validateUser() {
  const username = document.getElementById('login-username').value.trim();
  if (!username) {
    alert('Pon un nombre');
    feedback('error');
    return false;
  }

  const savedUser = JSON.parse(localStorage.getItem(USER_STORAGE_KEY)) || {};
  currentUser = {
    id: savedUser.id || crypto.randomUUID(),
    username
  };

  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
  return true;
}

function showScreen(screenId) {
  Object.values(screens).forEach(s => s.classList.remove('active', 'screen-enter'));
  if (screenId !== 'game') stopTimer();
  screens[screenId].classList.add('active', 'screen-enter');
}

function resetHomeUI() {
  document.getElementById('login-actions').classList.remove('hidden');
  document.getElementById('join-container').classList.add('hidden');
  document.getElementById('config-container').classList.add('hidden');
  document.getElementById('join-code').value = '';

  if (currentUser) document.getElementById('login-username').value = currentUser.username;
}

function goHome({ skipRoute = false } = {}) {
  feedback('click');
  closeSocket();
  stopTimer();
  currentRoom = null;
  reconnectAttempts = 0;
  urlRoomCode = null;
  resetHomeUI();
  if (!skipRoute) setRoute(HOME_VIEW);
  showScreen('login');
}

function leaveRoomAndGoHome({ askConfirmation = false, skipRoute = false } = {}) {
  if (askConfirmation && !confirm('¿Seguro que quieres salir de la partida?')) return;

  feedback('click');
  closeSocket();
  stopTimer();
  clearPersistedRoom();
  currentRoom = null;
  reconnectAttempts = 0;
  urlRoomCode = null;
  resetHomeUI();
  if (!skipRoute) setRoute(HOME_VIEW);
  showScreen('login');
}

function closeSocket() {
  socketSessionId += 1;
  socketRoomCode = null;
  stopRoomSyncFallback();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const socketToClose = socket;
  socket = null;

  try {
    if (socketToClose?.close) socketToClose.close();
    else if (typeof socketToClose?.then === 'function') {
      socketToClose.then(openSocket => openSocket?.close?.()).catch(() => {});
    }
  } catch (error) {
    console.warn('No se pudo cerrar IttySockets correctamente', error);
  }
}

function feedback(type = 'click') {
  vibrate(type);
  playSound(type);
}

function vibrate(type) {
  if (!navigator.vibrate) return;

  const patterns = {
    click: 15,
    vote: [20, 20, 30],
    reveal: [40, 30, 80],
    success: [25, 20, 25],
    error: [80, 30, 80]
  };

  navigator.vibrate(patterns[type] || patterns.click);
}

function playSound(type) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  const tones = {
    click: [560, 0.04, 'sine'],
    vote: [720, 0.08, 'triangle'],
    reveal: [220, 0.22, 'sawtooth'],
    success: [880, 0.16, 'sine'],
    error: [140, 0.16, 'square']
  };
  const [frequency, duration, wave] = tones[type] || tones.click;

  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (type === 'success') oscillator.frequency.exponentialRampToValueAtTime(1320, now + duration);
  if (type === 'reveal') oscillator.frequency.exponentialRampToValueAtTime(90, now + duration);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function animateElement(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function getPlayers() {
  return currentRoom?.game_state?.players || [];
}

function getAlivePlayers(players = getPlayers()) {
  return players.filter(player => !player.eliminated);
}

function isCurrentUserHost() {
  const currentId = String(currentUser?.id ?? '');
  if (!currentId) return false;
  if (String(currentRoom?.host_id ?? '') === currentId) return true;
  return getPlayers().some(player => String(player.id) === currentId && player.isHost);
}

function isVoteSecret() {
  return currentRoom?.room_settings?.voteSecret !== false;
}

function isRandomOrderEnabled(settings = currentRoom?.room_settings) {
  return settings?.randomOrder === true;
}

function hasDuplicatedName(players, username, ownId = currentUser?.id) {
  const normalizedUsername = username.trim().toLowerCase();

  return players.some(player =>
    player.id !== ownId &&
    String(player.name || '').trim().toLowerCase() === normalizedUsername
  );
}

function buildCurrentPlayer(overrides = {}) {
  return {
    id: currentUser.id,
    name: currentUser.username,
    points: 0,
    eliminated: false,
    ...overrides
  };
}

function buildLobbyPlayer(player, overrides = {}) {
  return {
    id: player.id,
    name: player.name,
    points: Number(player.points) || 0,
    eliminated: false,
    isHost: player.isHost || String(player.id) === String(currentRoom?.host_id),
    ...overrides
  };
}


function normalizeRoomCode(code) {
  return code ? String(code).trim().toUpperCase() : code;
}

function normalizeRoomResponse(response) {
  if (!response) return null;
  if (response.room) return normalizeRoomResponse(response.room);
  if (response.data?.room) return normalizeRoomResponse(response.data.room);
  if (response.data && (response.data.room_code || response.data.game_state || response.data.status)) {
    return normalizeRoomResponse(response.data);
  }
  if (response.room_code || response.game_state || response.status) return response;
  return null;
}

function normalizeRoom(room, fallback = {}) {
  const normalized = normalizeRoomResponse(room) || {};
  const gameState = normalized.game_state || fallback.gameState || currentRoom?.game_state || {};
  const roomSettings = normalized.room_settings || fallback.roomSettings || currentRoom?.room_settings || {};
  const status = normalized.status || fallback.status || gameState.status || currentRoom?.status || 'waiting';
  const roomCode = normalizeRoomCode(normalized.room_code || fallback.roomCode || currentRoom?.room_code || socketRoomCode);

  return {
    ...currentRoom,
    ...normalized,
    room_code: roomCode,
    status,
    room_settings: roomSettings,
    game_state: gameState
  };
}

function getRoomSignature(room) {
  const normalized = normalizeRoom(room);
  if (!normalized?.room_code && !normalized?.status) return '';

  return JSON.stringify({
    room_code: normalized.room_code,
    status: normalized.status,
    room_settings: normalized.room_settings || {},
    game_state: normalized.game_state || {}
  });
}

function mergeRoomResponse(response, fallback = {}) {
  currentRoom = normalizeRoom(response, fallback);

  if (currentRoom.room_code) {
    persistRoom(currentRoom.room_code);
    if (socketRoomCode !== currentRoom.room_code) initSocket(currentRoom.room_code);
  }

  updateUIFromState();
  return response;
}

async function patchRoomState({ gameState, status, roomSettings } = {}) {
  if (!currentRoom?.room_code) throw new Error('No hay sala activa');

  const nextGameState = gameState
    ? { ...gameState, ...(status ? { status } : {}) }
    : (status ? { ...(currentRoom.game_state || {}), status } : undefined);

  const response = await api.updateRoomState(currentRoom.room_code, {
    gameState: nextGameState,
    status,
    roomSettings
  });
  mergeRoomResponse(response, { gameState: nextGameState, status, roomSettings, roomCode: currentRoom.room_code });
  broadcastRoomState();
  setTimeout(() => refreshRoom({ forceRender: true }), 250);
  return response;
}

async function ensureCurrentPlayerInRoom() {
  const players = getPlayers();
  const existingPlayer = players.find(player => player.id === currentUser.id);

  if (existingPlayer?.name === currentUser.username) return;

  const updatedPlayers = existingPlayer
    ? players.map(player => player.id === currentUser.id ? { ...player, name: currentUser.username } : player)
    : [...players, buildCurrentPlayer()];

  await patchRoomState({
    gameState: {
      ...currentRoom.game_state,
      players: updatedPlayers
    }
  });
}

function persistRoom(roomCode) {
  localStorage.setItem(ROOM_STORAGE_KEY, roomCode);
}

function clearPersistedRoom() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
}

function getRoomUrl(roomCode = currentRoom?.room_code) {
  return `${window.location.origin}${window.location.pathname}?room=${roomCode}&view=unirse`;
}

function getShareText(roomCode = currentRoom?.room_code) {
  return `Únete a mi partida de Infiltrado 🔥 Código: ${roomCode} ${getRoomUrl(roomCode)}`;
}

function updateSharePanel() {
  if (!currentRoom?.room_code) return;

  const roomUrl = getRoomUrl();
  const qr = document.getElementById('room-qr');
  const linkDisplay = document.getElementById('room-link-display');

  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(roomUrl)}`;
  linkDisplay.innerText = roomUrl;
}

function getSelectedRoomSettings() {
  const mode = document.getElementById('config-mode').value;
  const maxRounds = Math.max(1, Math.min(10, parseInt(document.getElementById('config-rounds').value, 10) || 3));

  return {
    mode,
    modeLabel: getModeLabel(mode),
    modeDescription: getModeDescription(mode),
    timerSeconds: parseInt(document.getElementById('config-timer').value, 10) || 30,
    infiltradoMode: mode === 'blind' ? 'none' : document.getElementById('config-infiltrado-word').value,
    showCategory: document.getElementById('config-show-category').value,
    voteSecret: document.getElementById('config-vote-secret').value === 'secret',
    randomOrder: document.getElementById('config-random-order').value === 'random',
    maxRounds
  };
}

async function createRoom() {
  feedback('click');

  try {
    const res = await api.createRoom(GAME_ID, currentUser.id, getSelectedRoomSettings(), {
      status: 'waiting',
      players: [buildCurrentPlayer({ isHost: true })]
    });

    currentRoom = normalizeRoom(res, { status: 'waiting', gameState: { status: 'waiting', players: [buildCurrentPlayer({ isHost: true })] } });
    persistRoom(currentRoom.room_code);
    initSocket(currentRoom.room_code);
    renderLobby();
    feedback('success');
    setRoute('sala', { roomCode: currentRoom.room_code });
    showScreen('lobby');
  } catch (e) {
    console.error(e);
    feedback('error');
    alert('No se pudo crear la sala');
  }
}

async function joinRoom(code, { silent = false, replaceRoute = false } = {}) {
  try {
    const room = await api.getRoom(code);

    if (hasDuplicatedName(room.game_state?.players || [], currentUser.username)) {
      feedback('error');
      alert('Ya hay un jugador con ese nombre en la sala');
      showLoginSubscreen('join', { roomCode: code, replaceRoute: true });
      return;
    }

    const res = await api.joinRoom(code, currentUser.id);
    currentRoom = normalizeRoom(res, {
      roomCode: code,
      status: normalizeRoom(room, { roomCode: code }).status,
      roomSettings: normalizeRoom(room, { roomCode: code }).room_settings,
      gameState: normalizeRoom(room, { roomCode: code }).game_state
    });
    persistRoom(currentRoom.room_code || code);
    initSocket(currentRoom.room_code || code);
    await ensureCurrentPlayerInRoom();
    emitSocketEvent('player_joined', { room_code: currentRoom.room_code || code });

    feedback('success');
    setRoute(routeForStatus(currentRoom.status), { roomCode: currentRoom.room_code || code, replace: replaceRoute });
    updateUIFromState({ skipRoute: true });
  } catch (e) {
    console.error(e);
    clearPersistedRoom();
    feedback('error');
    if (!silent) alert('No se pudo entrar en la sala');
    showLoginSubscreen('join', { roomCode: code, replaceRoute: true });
  }
}

async function refreshRoom({ forceRender = false } = {}) {
  if (!currentRoom?.room_code) return;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const previousSignature = getRoomSignature(currentRoom);
      const res = await api.getRoom(currentRoom.room_code);
      const nextRoom = normalizeRoom(res, { roomCode: currentRoom.room_code });
      const nextSignature = getRoomSignature(nextRoom);
      currentRoom = nextRoom;

      if (forceRender || nextSignature !== previousSignature || nextSignature !== lastRenderedRoomSignature) {
        updateUIFromState();
      }
    } catch (e) {
      console.error('No se pudo refrescar la sala', e);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function getSocketChannel(code) {
  return `infiltrado:room:${normalizeRoomCode(code)}`;
}

function initSocket(code) {
  closeSocket();

  const sessionId = socketSessionId + 1;
  socketSessionId = sessionId;
  socketRoomCode = normalizeRoomCode(code);
  startRoomSyncFallback(socketRoomCode, sessionId);
  setTimeout(() => refreshRoom({ forceRender: true }), 0);

  try {
    const connection = connect(getSocketChannel(socketRoomCode));
    socket = connection;

    Promise.resolve(connection).then(openedSocket => {
      if (socketSessionId !== sessionId || socketRoomCode !== normalizeRoomCode(code)) {
        openedSocket?.close?.();
        return;
      }

      socket = openedSocket;
      bindSocketEvent(openedSocket, 'player_joined', () => refreshRoom({ forceRender: true }));
      bindSocketEvent(openedSocket, 'room_changed', () => refreshRoom({ forceRender: true }));
      bindSocketEvent(openedSocket, 'state_updated', (data) => handleRemoteStateUpdate(data, sessionId));
      bindSocketEvent(openedSocket, 'message', (message) => handleSocketMessage(message, sessionId));
      bindSocketEvent(openedSocket, 'data', (message) => handleSocketMessage(message, sessionId));
      bindSocketEvent(openedSocket, 'open', () => {
        if (socketSessionId === sessionId) reconnectAttempts = 0;
      });
      bindSocketEvent(openedSocket, 'close', () => {
        if (socketSessionId === sessionId && socketRoomCode === String(code).trim().toUpperCase() && normalizeRoomCode(currentRoom?.room_code) === socketRoomCode) reconnectSocket(socketRoomCode, sessionId);
      });
      bindSocketEvent(openedSocket, 'error', (err) => {
        console.error('Socket error', err);
      });

      reconnectAttempts = 0;
    }).catch(error => {
      console.error('No se pudo conectar con IttySockets', error);
      if (socketSessionId === sessionId && socketRoomCode === String(code).trim().toUpperCase() && normalizeRoomCode(currentRoom?.room_code) === socketRoomCode) reconnectSocket(socketRoomCode, sessionId);
    });
  } catch (error) {
    console.error('No se pudo conectar con IttySockets', error);
    if (socketSessionId === sessionId && socketRoomCode === String(code).trim().toUpperCase() && normalizeRoomCode(currentRoom?.room_code) === socketRoomCode) reconnectSocket(socketRoomCode, sessionId);
  }
}

function bindSocketEvent(targetSocket, eventName, handler) {
  if (!targetSocket) return;

  if (typeof targetSocket.on === 'function') {
    targetSocket.on(eventName, handler);
  }

  if (typeof targetSocket.addEventListener === 'function') {
    targetSocket.addEventListener(eventName, handler);
  }

  const propertyName = `on${eventName}`;
  if (propertyName in targetSocket) {
    const previousHandler = targetSocket[propertyName];
    targetSocket[propertyName] = (event) => {
      if (typeof previousHandler === 'function') previousHandler.call(targetSocket, event);
      handler(event);
    };
  }
}

function normalizeSocketMessage(message) {
  const raw = message?.detail ?? message?.data ?? message;
  if (typeof raw !== 'string') return raw;

  try {
    return JSON.parse(raw);
  } catch {
    return { type: raw };
  }
}

function handleSocketMessage(message, sessionId) {
  const data = normalizeSocketMessage(message);
  if (!data) return;
  if (data.room_code && data.room_code !== socketRoomCode) return;
  if (data.sender_id === currentUser?.id) return;

  if (data.type === 'state_updated') {
    handleRemoteStateUpdate(data.payload || data, sessionId);
    return;
  }

  if (data.type === 'player_joined' || data.type === 'room_changed' || data.type === 'state_changed') {
    refreshRoom({ forceRender: true });
  }
}

function handleRemoteStateUpdate(data, sessionId) {
  const payload = normalizeSocketMessage(data);
  const roomPayload = payload?.payload || payload;

  if (!currentRoom || socketSessionId !== sessionId) return;
  if (roomPayload?.room_code && normalizeRoomCode(roomPayload.room_code) !== normalizeRoomCode(currentRoom.room_code)) return;

  if (!roomPayload?.game_state && !roomPayload?.status && !roomPayload?.room_settings) {
    refreshRoom();
    return;
  }

  currentRoom = normalizeRoom(roomPayload, { roomCode: currentRoom.room_code });
  updateUIFromState();
  refreshRoom();
}

function emitSocketEvent(type, payload = {}) {
  if (!socket || !socketRoomCode) return;

  const message = {
    type,
    room_code: socketRoomCode,
    sender_id: currentUser?.id,
    payload
  };
  const serialized = JSON.stringify(message);

  Promise.resolve(socket).then(openSocket => {
    if (!openSocket || socketRoomCode !== message.room_code) return;

    const calls = [
      () => openSocket.send?.(serialized),
      () => openSocket.send?.(message),
      () => openSocket.emit?.(type, message),
      () => openSocket.emit?.('message', message),
      () => openSocket.publish?.(type, message),
      () => openSocket.publish?.('message', message),
      () => openSocket.dispatchEvent?.(new MessageEvent('message', { data: serialized }))
    ];

    calls.forEach(call => {
      try { call(); } catch {}
    });
  }).catch(error => {
    console.error('No se pudo emitir por IttySockets', error);
  });
}

function broadcastRoomState() {
  if (!currentRoom) return;

  emitSocketEvent('state_updated', {
    room_code: currentRoom.room_code,
    status: currentRoom.status,
    room_settings: currentRoom.room_settings,
    game_state: currentRoom.game_state
  });
  emitSocketEvent('room_changed', { room_code: currentRoom.room_code });
}

function startRoomSyncFallback(code, sessionId) {
  stopRoomSyncFallback();
  roomSyncTimer = setInterval(() => {
    if (socketSessionId !== sessionId || normalizeRoomCode(currentRoom?.room_code) !== normalizeRoomCode(code)) return;
    refreshRoom();
  }, ROOM_SYNC_FALLBACK_MS);
}

function stopRoomSyncFallback() {
  if (!roomSyncTimer) return;
  clearInterval(roomSyncTimer);
  roomSyncTimer = null;
}

function reconnectSocket(code, sessionId) {
  reconnectAttempts += 1;
  const delay = Math.min(SOCKET_RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), SOCKET_RECONNECT_MAX_MS);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (socketSessionId === sessionId && normalizeRoomCode(currentRoom?.room_code) === normalizeRoomCode(code)) initSocket(code);
  }, delay);
}

function updateUIFromState({ skipRoute = false } = {}) {
  const status = currentRoom?.status || currentRoom?.game_state?.status;
  if (!status) return;
  currentRoom.status = status;
  lastRenderedRoomSignature = getRoomSignature(currentRoom);
  if (!skipRoute) setRoute(routeForStatus(status), { roomCode: currentRoom.room_code });

  if (status === 'waiting') { renderLobby(); showScreen('lobby'); }
  else if (status === 'playing') { renderGame(); showScreen('game'); }
  else if (status === 'voting') { renderVoting(); showScreen('game'); }
  else if (status === 'round_results') { renderRoundResults(); showScreen('game'); }
  else if (status === 'results') { renderResults(); showScreen('results'); }
}

function renderLobby() {
  document.getElementById('room-code-display').innerText = currentRoom.room_code;
  updateSharePanel();
  renderModeSummary();

  const list = document.getElementById('players-list');
  list.innerHTML = '';
  getPlayers().forEach(p => {
    const el = document.importNode(document.getElementById('tpl-player').content, true);
    el.querySelector('.truncate').innerText = p.name + (String(p.id) === String(currentRoom.host_id) ? ' (Host)' : '');
    el.querySelector('.w-12').innerText = (p.name || '?')[0].toUpperCase();
    list.appendChild(el);
  });
  const isHost = isCurrentUserHost();
  document.getElementById('admin-controls').classList.toggle('hidden', !isHost);
  document.getElementById('waiting-message').classList.toggle('hidden', isHost);
}

function renderModeSummary() {
  const modeSummary = document.getElementById('mode-summary');
  const settings = currentRoom.room_settings || {};
  const mode = settings.mode || 'classic';
  const timerText = mode === 'timed' ? ` · ${settings.timerSeconds || 30}s por ronda` : '';
  const voteText = settings.voteSecret === false ? ' · voto público' : ' · voto secreto';
  const orderText = settings.randomOrder ? ' · orden aleatorio' : ' · orden fijo';

  modeSummary.classList.remove('hidden');
  modeSummary.innerHTML = `<strong>${GAME_MODES[mode]?.label || 'Clásico'}</strong>${timerText}${voteText}${orderText} · rondas hasta capturar al infiltrado<br><span class="text-gray-400">${getModeDescription(mode)}</span>`;
}

function renderGame() {
  const state = currentRoom.game_state;
  const myData = state.players.find(p => p.id == currentUser.id);
  if (!myData) {
    clearPersistedRoom();
    showScreen('login');
    return;
  }

  const catEl = document.getElementById('category-display');
  const showCat = currentRoom.room_settings?.showCategory;
  if (showCat === 'all' || (showCat === 'civil' && !myData.isInfiltrado)) {
    catEl.innerText = `Categoría: ${state.category}`;
    catEl.classList.remove('hidden');
  } else {
    catEl.classList.add('hidden');
  }

  renderRoleStatus(myData);
  renderCurrentTurn(state);
  maybeShowEliminationNotice(state, myData);

  const wordLabel = myData.eliminated
    ? (myData.isInfiltrado ? 'CAPTURADO' : 'ELIMINADO')
    : (myData.word || '???');

  document.getElementById('player-word').innerText = wordLabel;
  document.getElementById('game-status').innerText = `PARTIDA ${state.matchNumber || 1} · RONDA ${state.round || 1}`;
  renderTimerStatus();
  animateElement(document.getElementById('word-container'), myData.eliminated ? 'danger-pop' : 'glow-pulse');

  const turnList = document.getElementById('turn-list');
  const currentTurn = getCurrentTurn(state);
  turnList.innerHTML = '';
  getOrderedPlayersForDisplay(state).forEach((p, index) => {
    if (!p) return;
    const isCurrent = currentTurn?.player?.id == p.id;
    const span = document.createElement('span');
    span.className = [
      'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all',
      p.eliminated ? 'bg-gray-800 text-gray-600 line-through' : (isCurrent ? 'bg-brand text-white scale-110 shadow-lg shadow-brand/40 turn-chip-active' : 'bg-brand/20 text-brand')
    ].join(' ');
    span.innerText = `${index + 1}. ${p.name}`;
    turnList.appendChild(span);
  });

  document.getElementById('word-container').classList.remove('hidden');
  document.getElementById('voting-area').classList.add('hidden');
  document.getElementById('vote-reveal').classList.add('hidden');
  document.getElementById('btn-vote-stats').classList.toggle('hidden', !hasVoteHistory(state));

  const isHost = isCurrentUserHost();
  const btn = document.getElementById('btn-show-voting');
  const isLastTurn = currentTurn.index >= currentTurn.order.length - 1;
  btn.classList.toggle('hidden', !isHost);
  btn.innerText = isLastTurn ? 'Ir a votación' : 'Continuar';
  btn.classList.toggle('bg-red-500/20', isLastTurn);
  btn.classList.toggle('border-red-400', isLastTurn);
  btn.classList.toggle('text-red-200', isLastTurn);
  btn.classList.toggle('bg-brand/20', !isLastTurn);
  btn.classList.toggle('border-brand', !isLastTurn);
  btn.classList.toggle('text-brand', !isLastTurn);
}

function renderRoleStatus(myData) {
  const roleStatus = document.getElementById('role-status');
  if (!roleStatus || !myData) return;

  roleStatus.classList.remove('hidden', 'bg-blue-500/20', 'text-blue-200', 'border-blue-400/50', 'bg-red-500/20', 'text-red-200', 'border-red-400/50');

  if ((currentRoom?.room_settings?.mode || currentRoom?.game_state?.mode) === 'blind') {
    roleStatus.innerText = '';
    roleStatus.classList.add('hidden');
    return;
  }

  roleStatus.classList.add('role-badge');

  if (myData.isInfiltrado) {
    roleStatus.innerText = myData.eliminated ? 'ERAS INFILTRADO' : 'ERES INFILTRADO';
    roleStatus.classList.add('bg-red-500/20', 'text-red-200', 'border-red-400/50');
  } else {
    roleStatus.innerText = myData.eliminated ? 'ERAS CIVIL' : 'ERES CIVIL';
    roleStatus.classList.add('bg-blue-500/20', 'text-blue-200', 'border-blue-400/50');
  }
}

function renderCurrentTurn(state) {
  const card = document.getElementById('current-turn-card');
  const nameEl = document.getElementById('current-turn-name');
  const hintEl = document.getElementById('current-turn-hint');
  if (!card || !nameEl || !hintEl) return;

  const currentTurn = getCurrentTurn(state);
  if (!currentTurn.player) {
    clearCurrentTurn();
    return;
  }

  const isMe = currentTurn.player.id == currentUser.id;
  card.classList.remove('hidden', 'my-turn', 'other-turn');
  card.classList.add(isMe ? 'my-turn' : 'other-turn');
  nameEl.innerText = currentTurn.player.name;
  hintEl.innerText = isMe
    ? 'Te toca hablar. Describe sin decir tu palabra.'
    : `Escucha a ${currentTurn.player.name} y busca contradicciones.`;

  const turnInfo = document.getElementById('turn-info');
  if (turnInfo) {
    turnInfo.innerText = isMe
      ? '¡Te toca! Di algo relacionado sin revelar demasiado.'
      : (isCurrentUserHost() ? 'Pulsa Continuar cuando termine este turno.' : 'Escucha y prepara tu siguiente pista.');
  }

  if (isMe && !currentTurn.player.eliminated) {
    maybeShowTurnNotice(state, currentTurn);
  }
}

function clearCurrentTurn() {
  const card = document.getElementById('current-turn-card');
  if (card) card.classList.add('hidden');
  const info = document.getElementById('turn-info');
  if (info) info.innerText = 'Vota cuando tengas claro quién no encaja.';
}

function getCurrentTurn(state) {
  const order = getAliveTurnOrder(state);
  if (!order.length) return { order, index: 0, player: null };

  const safeIndex = Math.min(Math.max(Number(state.currentTurnIndex) || 0, 0), order.length - 1);
  const player = state.players.find(candidate => candidate.id == order[safeIndex]) || null;
  return { order, index: safeIndex, player };
}

function getAliveTurnOrder(state) {
  const aliveIds = new Set(getAlivePlayers(state.players || []).map(player => player.id));
  const ordered = (state.turnOrder || []).filter(id => aliveIds.has(id));
  const missing = [...aliveIds].filter(id => !ordered.includes(id));
  return [...ordered, ...missing];
}

function getOrderedPlayersForDisplay(state) {
  const players = state.players || [];
  const byId = new Map(players.map(player => [player.id, player]));
  const seen = new Set();
  const ordered = [];

  (state.turnOrder || []).forEach(id => {
    const player = byId.get(id);
    if (!player || seen.has(player.id)) return;
    seen.add(player.id);
    ordered.push(player);
  });

  players.forEach(player => {
    if (seen.has(player.id)) return;
    ordered.push(player);
  });

  return ordered;
}

function buildTurnOrder(players, { randomize = isRandomOrderEnabled() } = {}) {
  const alive = players.filter(player => !player.eliminated).map(player => player.id);
  const eliminated = players.filter(player => player.eliminated).map(player => player.id);
  const orderedAlive = randomize
    ? alive.map(id => ({ id, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map(item => item.id)
    : alive;

  return [...orderedAlive, ...eliminated];
}

function buildNextRoundTurnOrder(players, previousOrder = [], { randomize = isRandomOrderEnabled() } = {}) {
  if (randomize) return buildTurnOrder(players, { randomize: true });

  const aliveIds = new Set(players.filter(player => !player.eliminated).map(player => player.id));
  const kept = previousOrder.filter(id => aliveIds.has(id));
  const missing = players
    .filter(player => !player.eliminated && !kept.includes(player.id))
    .map(player => player.id);
  const eliminated = players.filter(player => player.eliminated).map(player => player.id);

  return [...kept, ...missing, ...eliminated];
}

function maybeShowEliminationNotice(state, myData) {
  const elimination = state.lastElimination;
  if (!elimination || elimination.id != currentUser.id) return;

  const noticeKey = `${state.matchNumber || 1}:${elimination.round || state.round}:${elimination.id}:${elimination.captured ? 'captured' : 'eliminated'}`;
  if (lastEliminationNoticeKey === noticeKey) return;
  lastEliminationNoticeKey = noticeKey;
  showEliminationNotice(elimination, myData);
}

function showEliminationNotice(elimination, myData) {
  const overlay = document.getElementById('event-overlay');
  const title = document.getElementById('event-overlay-title');
  const subtitle = document.getElementById('event-overlay-subtitle');
  if (!overlay || !title || !subtitle) return;

  const captured = elimination.captured || myData?.isInfiltrado;
  title.innerText = captured ? 'CAPTURADO' : 'ELIMINADO';
  subtitle.innerText = captured
    ? 'Te han pillado siendo infiltrado. Sigue mirando cómo acaba la partida.'
    : 'La mayoría ha votado por ti. Sigues viendo la partida, pero ya no votas.';

  overlay.classList.remove('hidden', 'captured-event', 'eliminated-event');
  overlay.classList.add(captured ? 'captured-event' : 'eliminated-event');
  feedback(captured ? 'error' : 'reveal');

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('captured-event', 'eliminated-event');
  }, 2800);
}

function renderTimerStatus() {
  const timerStatus = document.getElementById('timer-status');
  const state = currentRoom.game_state;
  const isTimed = state.mode === 'timed';

  timerStatus.classList.toggle('hidden', !isTimed);
  stopTimer();
  timerExpiredNotified = false;

  if (!isTimed) return;

  const updateTimer = () => {
    const elapsed = Math.floor((Date.now() - (state.roundStartedAt || Date.now())) / 1000);
    const remaining = Math.max((state.timerSeconds || 30) - elapsed, 0);
    timerStatus.innerText = `${remaining}s`;

    if (remaining === 0 && !timerExpiredNotified) {
      timerExpiredNotified = true;
      feedback('reveal');
    }
  };

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;
}

function renderVoting() {
  stopTimer();
  const state = currentRoom.game_state;
  const myData = state.players.find(p => p.id == currentUser.id);
  if (!myData) {
    clearPersistedRoom();
    showScreen('login');
    return;
  }

  renderRoleStatus(myData);
  clearCurrentTurn();
  maybeShowEliminationNotice(state, myData);

  document.getElementById('word-container').classList.add('hidden');
  document.getElementById('voting-area').classList.remove('hidden');
  document.getElementById('btn-show-voting').classList.add('hidden');
  document.getElementById('game-status').innerText = `PARTIDA ${state.matchNumber || 1} · VOTACIÓN RONDA ${state.round || 1}`;
  document.getElementById('timer-status').classList.add('hidden');
  document.getElementById('turn-order-container').classList.remove('hidden');

  const voteReveal = document.getElementById('vote-reveal');
  voteReveal.classList.add('hidden');
  voteReveal.innerHTML = '';
  document.getElementById('btn-vote-stats').classList.toggle('hidden', !hasVoteHistory(state));

  const votes = state.votes || {};
  const hasVoted = Boolean(votes[currentUser.id]);
  const grid = document.getElementById('vote-grid');
  grid.innerHTML = '';
  state.players.forEach(p => {
    if (p.id == currentUser.id || p.eliminated) return;
    const el = document.importNode(document.getElementById('tpl-vote-card').content, true);
    const btn = el.querySelector('button');
    btn.querySelector('span').innerText = p.name;
    btn.querySelector('.w-16').innerText = (p.name || '?')[0].toUpperCase();

    if (myData.eliminated || hasVoted) {
      btn.disabled = true;
      btn.classList.add('voted');
    } else {
      btn.onclick = () => castVote(p.id, btn);
    }

    if (votes[currentUser.id] == p.id) btn.classList.add('selected');
    grid.appendChild(el);
  });

  const aliveVoters = getAlivePlayers(state.players).length;
  const votesCount = Object.keys(votes).length;
  document.getElementById('turn-info').innerText = myData.eliminated
    ? `Estás eliminado. Votos recibidos: ${votesCount}/${aliveVoters}`
    : (hasVoted ? `Voto registrado. Esperando al resto: ${votesCount}/${aliveVoters}` : `Vota al infiltrado. Votos: ${votesCount}/${aliveVoters}`);
}

function renderRoundResults() {
  stopTimer();
  const state = currentRoom.game_state;
  const myData = state.players.find(p => p.id == currentUser.id);
  if (!myData) {
    clearPersistedRoom();
    showScreen('login');
    return;
  }

  renderRoleStatus(myData);
  clearCurrentTurn();
  maybeShowEliminationNotice(state, myData);

  const lastSummary = state.lastVoteSummary;
  document.getElementById('word-container').classList.add('hidden');
  document.getElementById('voting-area').classList.remove('hidden');
  document.getElementById('timer-status').classList.add('hidden');
  document.getElementById('turn-order-container').classList.add('hidden');
  document.getElementById('game-status').innerText = `PARTIDA ${state.matchNumber || 1} · RESULTADO RONDA ${lastSummary?.round || state.round || 1}`;

  const grid = document.getElementById('vote-grid');
  grid.innerHTML = '';

  const eliminated = lastSummary?.eliminated || state.lastElimination;
  const resultCard = document.createElement('div');
  resultCard.className = 'col-span-2 bg-gray-900 border-2 border-red-400/60 rounded-3xl p-5 text-center danger-pop';
  resultCard.innerHTML = `
    <p class="text-[10px] uppercase tracking-[0.35em] text-gray-500 font-black mb-2">Jugador eliminado</p>
    <h3 class="text-3xl font-black ${eliminated?.captured ? 'text-red-300' : 'text-brand'}">${eliminated?.name || 'Sin eliminado'}</h3>
    <p class="text-xs text-gray-400 mt-2 font-bold">${eliminated?.captured ? 'Era infiltrado y ha sido capturado.' : 'No era infiltrado. La partida continúa.'}</p>
  `;
  grid.appendChild(resultCard);

  renderVoteReveal(lastSummary);
  document.getElementById('btn-vote-stats').classList.toggle('hidden', !hasVoteHistory(state));

  const isHost = isCurrentUserHost();
  const btn = document.getElementById('btn-show-voting');
  btn.classList.toggle('hidden', !isHost);
  btn.innerText = 'Continuar';
  btn.classList.remove('bg-red-500/20', 'border-red-400', 'text-red-200');
  btn.classList.add('bg-brand/20', 'border-brand', 'text-brand');

  document.getElementById('turn-info').innerText = isHost
    ? 'Pulsa Continuar para empezar la siguiente ronda.'
    : 'Esperando a que el admin continúe con la siguiente ronda.';
}

function renderVoteReveal(summary = currentRoom?.game_state?.lastVoteSummary) {
  const container = document.getElementById('vote-reveal');
  if (!container) return;
  container.innerHTML = '';

  if (!summary) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'bg-gray-900/80 border border-gray-800 rounded-2xl p-4 text-left';
  title.innerHTML = `<p class="text-[10px] uppercase tracking-[0.3em] text-gray-500 font-black mb-2">Votación</p><p class="font-black text-white">${summary.secret ? 'Voto secreto activado' : 'Quién votó a quién'}</p>`;
  container.appendChild(title);

  if (summary.secret) {
    const hidden = document.createElement('p');
    hidden.className = 'text-center text-xs text-gray-500 bg-gray-900 rounded-2xl p-4';
    hidden.innerText = 'Esta sala usa voto secreto. No se muestra quién votó a quién.';
    container.appendChild(hidden);
  } else {
    (summary.votes || []).forEach((vote, index) => {
      const row = document.createElement('div');
      row.className = 'vote-reveal-row flex items-center justify-between gap-3 bg-gray-900 rounded-2xl p-3 border border-gray-800';
      row.style.animationDelay = `${index * 45}ms`;
      row.innerHTML = `<span class="font-bold truncate">${vote.voterName}</span><span class="text-gray-500 text-xs">votó a</span><span class="font-black text-brand truncate text-right">${vote.targetName}</span>`;
      container.appendChild(row);
    });
  }

  if (summary.counts?.length) {
    const counts = document.createElement('div');
    counts.className = 'bg-gray-900/70 rounded-2xl p-4 border border-gray-800 space-y-2';
    counts.innerHTML = '<p class="text-[10px] uppercase tracking-[0.3em] text-gray-500 font-black">Recuento</p>';
    summary.counts.forEach(item => {
      const row = document.createElement('div');
      row.className = 'flex justify-between text-sm';
      row.innerHTML = `<span>${item.name}</span><span class="font-black text-brand">${item.votes}</span>`;
      counts.appendChild(row);
    });
    container.appendChild(counts);
  }
}

function hasVoteHistory(state = currentRoom?.game_state) {
  return Boolean(state?.voteHistory?.length || state?.lastVoteSummary);
}

function showVoteStats() {
  const modal = document.getElementById('vote-stats-modal');
  const content = document.getElementById('vote-stats-content');
  const history = currentRoom?.game_state?.voteHistory || [];
  content.innerHTML = '';

  if (!history.length) {
    content.innerHTML = '<p class="text-center text-gray-500 text-sm p-4">Todavía no hay votaciones registradas.</p>';
  }

  history.slice().reverse().forEach(summary => {
    const block = document.createElement('div');
    block.className = 'bg-gray-900/80 border border-gray-800 rounded-2xl p-4 space-y-3';
    const eliminated = summary.eliminated?.name || 'Sin eliminado';
    block.innerHTML = `
      <div class="flex justify-between gap-3 items-start">
        <div>
          <p class="text-[10px] uppercase tracking-[0.25em] text-gray-500 font-black">Partida ${summary.matchNumber || 1} · Ronda ${summary.round || 1}</p>
          <h3 class="font-black text-white mt-1">Eliminado: <span class="text-brand">${eliminated}</span></h3>
        </div>
        <span class="text-[10px] font-black uppercase rounded-full px-2 py-1 ${summary.secret ? 'bg-gray-800 text-gray-400' : 'bg-brand/20 text-brand'}">${summary.secret ? 'Secreto' : 'Público'}</span>
      </div>
    `;

    if (!summary.secret && summary.votes?.length) {
      const votesWrap = document.createElement('div');
      votesWrap.className = 'space-y-2';
      summary.votes.forEach(vote => {
        const row = document.createElement('div');
        row.className = 'flex justify-between gap-3 text-sm bg-gray-950/70 rounded-xl p-2';
        row.innerHTML = `<span class="truncate">${vote.voterName}</span><span class="text-gray-500">→</span><strong class="text-brand truncate text-right">${vote.targetName}</strong>`;
        votesWrap.appendChild(row);
      });
      block.appendChild(votesWrap);
    } else if (summary.secret) {
      const secret = document.createElement('p');
      secret.className = 'text-xs text-gray-500';
      secret.innerText = 'Voto secreto: no se revela quién votó a quién.';
      block.appendChild(secret);
    }

    if (summary.counts?.length) {
      const countsWrap = document.createElement('div');
      countsWrap.className = 'pt-2 border-t border-gray-800 space-y-1';
      summary.counts.forEach(item => {
        const row = document.createElement('div');
        row.className = 'flex justify-between text-xs text-gray-400';
        row.innerHTML = `<span>${item.name}</span><span>${item.votes} voto${item.votes === 1 ? '' : 's'}</span>`;
        countsWrap.appendChild(row);
      });
      block.appendChild(countsWrap);
    }

    content.appendChild(block);
  });

  modal.classList.remove('hidden');
  feedback('click');
}

function hideVoteStats() {
  document.getElementById('vote-stats-modal').classList.add('hidden');
}

function maybeShowTurnNotice(state, currentTurn) {
  const key = `${state.matchNumber || 1}:${state.round || 1}:${currentTurn.index}:${currentTurn.player?.id}`;
  if (lastTurnNoticeKey === key) return;
  lastTurnNoticeKey = key;
  showTurnNotice();
}

function showTurnNotice() {
  const overlay = document.getElementById('turn-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  feedback('success');
  setTimeout(() => overlay.classList.add('hidden'), 1800);
}

function renderResults() {
  stopTimer();
  const state = currentRoom.game_state;
  const resultsList = document.getElementById('results-list');
  resultsList.innerHTML = '';
  const infiltrados = state.players.filter(p => p.isInfiltrado);
  document.getElementById('results-winner').innerText = state.winner === 'infiltrado' ? '¡GANAN LOS INFILTRADOS!' : '¡CIVILES GANAN!';
  animateElement(document.getElementById('results-winner'), 'glow-pulse');
  feedback('reveal');

  const continueButton = document.getElementById('btn-back-lobby');
  const isHost = isCurrentUserHost();
  continueButton.innerText = 'Continuar Partida';
  continueButton.classList.toggle('hidden', !isHost);

  const info = document.createElement('p');
  info.className = 'text-center text-gray-400 mb-4';
  info.innerText = infiltrados.length
    ? `Infiltrado${infiltrados.length > 1 ? 's' : ''}: ${infiltrados.map(p => `${p.name} (${p.word || 'NADA'})`).join(', ')}`
    : 'No se encontró al infiltrado.';
  resultsList.appendChild(info);

  if (!isCurrentUserHost()) {
    const wait = document.createElement('p');
    wait.className = 'text-center text-xs text-gray-500 mb-4 uppercase tracking-widest';
    wait.innerText = 'Esperando a que el administrador continúe la partida';
    resultsList.appendChild(wait);
  }

  if (state.winnerReason) {
    const reason = document.createElement('p');
    reason.className = 'text-center text-xs text-gray-500 mb-4 uppercase tracking-widest';
    reason.innerText = state.winnerReason;
    resultsList.appendChild(reason);
  }

  if (hasVoteHistory(state)) {
    const statsButton = document.createElement('button');
    statsButton.type = 'button';
    statsButton.className = 'w-full bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-2xl p-3 text-xs font-black uppercase tracking-widest transition-all';
    statsButton.innerText = 'Estadísticas de votación';
    statsButton.onclick = showVoteStats;
    resultsList.appendChild(statsButton);
  }

  [...state.players].sort((a, b) => (b.points || 0) - (a.points || 0)).forEach(p => {
    const div = document.createElement('div');
    div.className = 'flex justify-between bg-gray-900 p-4 rounded-xl';
    div.innerHTML = `<span>${p.name}</span><span class="font-bold text-brand">${p.points || 0} pts</span>`;
    resultsList.appendChild(div);
  });
}

function buildStartGamePayload(players, { avoidPrevious = false } = {}) {
  const previousState = currentRoom.game_state || {};
  const pairIndex = pickWordPairIndex(previousState, { avoidPrevious });
  const pair = palabras[pairIndex];
  let roundState = createRoundState(players, currentRoom.room_settings, pair, palabras);

  if (avoidPrevious) {
    roundState = rerollInfiltradosIfNeeded(players, pair, roundState, previousState);
  }

  return {
    minPlayers: MIN_PLAYERS,
    pairIndex,
    wordPair: pair,
    wordPairs: palabras,
    proposedState: {
      ...previousState,
      ...roundState,
      pairIndex,
      wordPair: pair,
      turnOrder: buildTurnOrder(roundState.players, { randomize: isRandomOrderEnabled(currentRoom.room_settings) }),
      round: 1,
      currentTurnIndex: 0,
      votes: {},
      voteHistory: [],
      lastVoteSummary: null,
      winner: null,
      winnerReason: null,
      lastElimination: null
    }
  };
}

function pickWordPairIndex(previousState, { avoidPrevious = false } = {}) {
  if (!palabras.length) return 0;
  if (!avoidPrevious || palabras.length === 1) return Math.floor(Math.random() * palabras.length);

  const previousPairIndex = Number.isInteger(previousState.pairIndex) ? previousState.pairIndex : -1;
  const previousWords = new Set(
    (previousState.players || [])
      .map(player => String(player.word || '').trim().toLowerCase())
      .filter(Boolean)
  );

  let candidates = palabras
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair, index }) => {
      const sameIndex = index === previousPairIndex;
      const sameWords = (pair.palabras || []).some(word => previousWords.has(String(word || '').trim().toLowerCase()));
      return !sameIndex && !sameWords;
    });

  if (!candidates.length) {
    candidates = palabras
      .map((pair, index) => ({ pair, index }))
      .filter(({ index }) => index !== previousPairIndex);
  }

  if (!candidates.length) candidates = palabras.map((pair, index) => ({ pair, index }));

  return candidates[Math.floor(Math.random() * candidates.length)].index;
}

function rerollInfiltradosIfNeeded(players, pair, initialRoundState, previousState) {
  const previousInfiltradoIds = getInfiltradoIds(previousState.players || []);
  if (!previousInfiltradoIds.length || previousInfiltradoIds.length >= players.length) return initialRoundState;
  if (!sameIdSet(previousInfiltradoIds, getInfiltradoIds(initialRoundState.players))) return initialRoundState;

  let roundState = initialRoundState;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    roundState = createRoundState(players, currentRoom.room_settings, pair, palabras);
    if (!sameIdSet(previousInfiltradoIds, getInfiltradoIds(roundState.players))) return roundState;
  }

  const firstAlternative = players.find(player => !previousInfiltradoIds.includes(player.id));
  if (!firstAlternative) return roundState;

  const forcedIds = new Set(previousInfiltradoIds.map((_, index) => {
    if (index === 0) return firstAlternative.id;
    return players.find(player => player.id !== firstAlternative.id && !previousInfiltradoIds.includes(player.id))?.id || previousInfiltradoIds[index];
  }));

  const forcedPlayers = roundState.players.map(player => {
    const isInfiltrado = forcedIds.has(player.id);
    const sourcePlayer = initialRoundState.players.find(candidate => candidate.isInfiltrado === isInfiltrado);
    return {
      ...player,
      isInfiltrado,
      word: sourcePlayer?.word || player.word
    };
  });

  return { ...roundState, players: forcedPlayers };
}

function getInfiltradoIds(players) {
  return players.filter(player => player.isInfiltrado).map(player => player.id).sort();
}

function sameIdSet(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function resolveVotingState(state, votes) {
  const voters = getAlivePlayers(state.players);

  if (Object.keys(votes).length < voters.length) {
    return {
      status: 'voting',
      gameState: { ...state, votes }
    };
  }

  const countsById = {};
  Object.values(votes).forEach(id => {
    countsById[id] = (countsById[id] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(countsById));
  const tied = Object.keys(countsById).filter(id => countsById[id] === maxVotes);
  const eliminatedId = tied[Math.floor(Math.random() * tied.length)];
  const eliminatedPlayer = state.players.find(player => player.id == eliminatedId);
  const round = Number(state.round) || 1;
  const matchNumber = Number(state.matchNumber) || 1;
  const elimination = eliminatedPlayer ? {
    id: eliminatedPlayer.id,
    name: eliminatedPlayer.name,
    word: eliminatedPlayer.word,
    isInfiltrado: Boolean(eliminatedPlayer.isInfiltrado),
    captured: Boolean(eliminatedPlayer.isInfiltrado),
    round,
    matchNumber,
    at: Date.now()
  } : null;

  const players = state.players.map(player =>
    player.id == eliminatedId
      ? { ...player, eliminated: true, eliminatedRound: round, captured: Boolean(player.isInfiltrado) }
      : { ...player }
  );

  const voteSummary = buildVoteSummary({ ...state, players }, votes, countsById, elimination);
  const voteHistory = [...(state.voteHistory || []), voteSummary];

  let status = 'round_results';
  let winner = null;
  let winnerReason = null;
  const infiltrados = players.filter(player => player.isInfiltrado);
  const infiltradosAlive = infiltrados.filter(player => !player.eliminated).length;
  const civiliansAlive = players.filter(player => !player.isInfiltrado && !player.eliminated).length;

  if (infiltradosAllCaptured(players)) {
    winner = 'civiles';
    status = 'results';
    winnerReason = infiltrados.length > 1 ? 'Todos los infiltrados han sido capturados' : 'El infiltrado ha sido capturado';
    players.filter(player => !player.isInfiltrado).forEach(player => {
      player.points = (Number(player.points) || 0) + 1;
    });
  } else if (infiltradosAlive > 0 && infiltradosAlive >= civiliansAlive) {
    winner = 'infiltrado';
    status = 'results';
    winnerReason = civiliansAlive <= 1
      ? 'Solo queda un civil frente a los infiltrados'
      : 'Los infiltrados igualan o superan a los civiles vivos';
    infiltrados.filter(player => !player.eliminated).forEach(player => {
      player.points = (Number(player.points) || 0) + 2;
    });
  }

  return {
    status,
    gameState: {
      ...state,
      players,
      votes,
      voteHistory,
      lastVoteSummary: voteSummary,
      winner,
      winnerReason,
      round,
      roundStartedAt: state.roundStartedAt,
      turnOrder: state.turnOrder,
      currentTurnIndex: 0,
      lastElimination: elimination
    }
  };
}

function buildVoteSummary(state, votes, countsById, elimination) {
  const playersById = new Map((state.players || []).map(player => [String(player.id), player]));
  const voteRows = Object.entries(votes).map(([voterId, targetId]) => {
    const voter = playersById.get(String(voterId));
    const target = playersById.get(String(targetId));
    return {
      voterId,
      voterName: voter?.name || 'Jugador',
      targetId,
      targetName: target?.name || 'Jugador'
    };
  });

  const counts = Object.entries(countsById)
    .map(([targetId, total]) => ({
      id: targetId,
      name: playersById.get(String(targetId))?.name || 'Jugador',
      votes: total
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

  return {
    matchNumber: Number(state.matchNumber) || 1,
    round: Number(state.round) || 1,
    secret: isVoteSecret(),
    votes: voteRows,
    counts,
    eliminated: elimination,
    createdAt: Date.now()
  };
}

function infiltradosAllCaptured(players) {
  const infiltrados = players.filter(player => player.isInfiltrado);
  return infiltrados.length > 0 && infiltrados.every(player => player.eliminated);
}

async function startGame() {
  feedback('click');
  await refreshRoom({ forceRender: false });
  const players = getPlayers();

  if (!isCurrentUserHost()) {
    feedback('error');
    alert('Solo el host puede comenzar la partida');
    return;
  }

  if (players.length < MIN_PLAYERS) {
    feedback('error');
    alert(`Se necesitan al menos ${MIN_PLAYERS} jugadores`);
    return;
  }

  if ((currentRoom.room_settings?.mode || 'classic') === 'double' && players.length < 6) {
    feedback('error');
    alert('El modo doble infiltrado necesita al menos 6 jugadores');
    return;
  }

  try {
    const payload = buildStartGamePayload(players);
    await patchRoomState({
      status: 'playing',
      gameState: {
        ...payload.proposedState,
        matchNumber: 1
      }
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo comenzar la partida');
  }
}

async function advanceTurn() {
  feedback('click');
  await refreshRoom({ forceRender: false });

  if (!isCurrentUserHost()) {
    feedback('error');
    alert('Solo el host puede avanzar el turno');
    return;
  }

  const state = currentRoom.game_state;
  const status = currentRoom.status || state?.status;
  if (!state) return;

  if (status === 'round_results') {
    await continueAfterRound();
    return;
  }

  if (status !== 'playing') return;

  const currentTurn = getCurrentTurn(state);
  if (!currentTurn.order.length || currentTurn.index >= currentTurn.order.length - 1) {
    await goToVoting();
    return;
  }

  try {
    await patchRoomState({
      status: 'playing',
      gameState: {
        ...state,
        currentTurnIndex: currentTurn.index + 1
      }
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo avanzar el turno');
  }
}

async function continueAfterRound() {
  const state = currentRoom.game_state;
  if (!state || (currentRoom.status || state.status) !== 'round_results') return;

  const players = (state.players || []).map(player => ({ ...player }));
  const nextRound = (Number(state.round) || 1) + 1;

  try {
    await patchRoomState({
      status: 'playing',
      gameState: {
        ...state,
        players,
        status: 'playing',
        votes: {},
        round: nextRound,
        roundStartedAt: Date.now(),
        turnOrder: buildNextRoundTurnOrder(players, state.turnOrder, { randomize: isRandomOrderEnabled() }),
        currentTurnIndex: 0
      }
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo continuar la ronda');
  }
}

async function goToVoting() {
  feedback('click');
  await refreshRoom({ forceRender: false });

  if (!isCurrentUserHost()) {
    feedback('error');
    alert('Solo el host puede iniciar la votación');
    return;
  }

  try {
    await patchRoomState({
      status: 'voting',
      gameState: { ...currentRoom.game_state, votes: {} }
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo iniciar la votación');
  }
}

async function castVote(targetId, button) {
  if (voteSubmitting) return;

  const state = currentRoom.game_state;
  const myPlayer = state.players.find(player => player.id == currentUser.id);

  if (!myPlayer || myPlayer.eliminated || state.votes?.[currentUser.id]) return;

  const target = state.players.find(player => player.id == targetId && !player.eliminated);
  if (!target) {
    feedback('error');
    return;
  }

  voteSubmitting = true;
  feedback('vote');
  button?.classList.add('selected');
  document.querySelectorAll('.vote-card').forEach(btn => {
    btn.disabled = true;
    btn.classList.add('voted');
  });

  try {
    await refreshRoom();
    const freshState = currentRoom.game_state;
    const freshPlayer = freshState.players.find(player => player.id == currentUser.id);

    if (!freshPlayer || freshPlayer.eliminated || freshState.votes?.[currentUser.id]) return;

    const votes = { ...(freshState.votes || {}), [currentUser.id]: targetId };
    await patchRoomState(resolveVotingState(freshState, votes));
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo registrar el voto');
    await refreshRoom();
  } finally {
    voteSubmitting = false;
  }
}

async function continueGame() {
  feedback('click');

  if (!isCurrentUserHost()) {
    feedback('error');
    alert('Solo el host puede continuar la partida');
    return;
  }

  try {
    await refreshRoom({ forceRender: false });
    const players = getPlayers().map(player => buildLobbyPlayer(player, { isHost: String(player.id) === String(currentRoom.host_id) }));

    if (players.length < MIN_PLAYERS) {
      feedback('error');
      alert(`Se necesitan al menos ${MIN_PLAYERS} jugadores`);
      return;
    }

    if ((currentRoom.room_settings?.mode || 'classic') === 'double' && players.length < 6) {
      feedback('error');
      alert('El modo doble infiltrado necesita al menos 6 jugadores');
      return;
    }

    const payload = buildStartGamePayload(players, { avoidPrevious: true });
    await patchRoomState({
      status: 'playing',
      gameState: {
        ...payload.proposedState,
        matchNumber: (Number(currentRoom.game_state?.matchNumber) || 1) + 1
      }
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo continuar la partida');
  }
}

function showQrModal() {
  const modal = document.getElementById('qr-modal');
  const modalImg = document.getElementById('qr-modal-img');
  const modalLink = document.getElementById('qr-modal-link');
  const qr = document.getElementById('room-qr');
  if (!modal || !modalImg || !qr) return;

  modalImg.src = qr.src;
  if (modalLink) modalLink.innerText = getRoomUrl();
  modal.classList.remove('hidden');
  feedback('click');
}

function hideQrModal() {
  document.getElementById('qr-modal')?.classList.add('hidden');
}

function shareRoom() {
  feedback('click');
  const url = getRoomUrl();
  if (navigator.share) navigator.share({ title: 'Infiltrado', text: getShareText(), url });
  else copyRoomLink();
}

function shareRoomOnWhatsApp() {
  feedback('click');
  window.open(`https://wa.me/?text=${encodeURIComponent(getShareText())}`, '_blank', 'noopener,noreferrer');
}

async function copyRoomCode() {
  await navigator.clipboard.writeText(currentRoom.room_code);
  feedback('success');
  alert('Código copiado');
}

async function copyRoomLink() {
  await navigator.clipboard.writeText(getRoomUrl());
  feedback('success');
  alert('Enlace copiado');
}

init();
