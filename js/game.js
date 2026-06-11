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
const HOME_VIEW = 'inicio';

let currentUser = JSON.parse(localStorage.getItem(USER_STORAGE_KEY)) || null;
let currentRoom = null;
let socket = null;
let socketRoomCode = null;
let socketSessionId = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
let voteSubmitting = false;
let audioContext = null;
let timerInterval = null;
let timerExpiredNotified = false;
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
  document.getElementById('btn-show-voting').onclick = goToVoting;
  document.getElementById('btn-back-lobby').onclick = backToLobby;
  document.getElementById('btn-share').onclick = shareRoom;
  document.getElementById('btn-whatsapp').onclick = shareRoomOnWhatsApp;
  document.getElementById('btn-copy-code').onclick = copyRoomCode;
  document.getElementById('btn-copy-link').onclick = copyRoomLink;
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
  if (view === 'resultados') { renderResults(); showScreen('results'); return; }

  goHome({ skipRoute: true });
}

function routeForStatus(status) {
  if (status === 'waiting') return 'sala';
  if (status === 'playing') return 'partida';
  if (status === 'voting') return 'votacion';
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const socketToClose = socket;
  socket = null;
  if (socketToClose?.close) socketToClose.close();
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
    isHost: player.isHost || player.id == currentRoom?.host_id,
    ...overrides
  };
}

function normalizeRoomResponse(response) {
  if (!response) return null;
  if (response.room) return response.room;
  if (response.data?.room) return response.data.room;
  if (response.room_code || response.game_state || response.status) return response;
  return null;
}

function mergeRoomResponse(response, fallback = {}) {
  const room = normalizeRoomResponse(response);

  currentRoom = {
    ...currentRoom,
    ...(room || {}),
    room_settings: room?.room_settings || fallback.roomSettings || currentRoom?.room_settings || {},
    game_state: room?.game_state || fallback.gameState || currentRoom?.game_state || {},
    status: room?.status || fallback.status || currentRoom?.status
  };

  if (currentRoom.room_code) {
    persistRoom(currentRoom.room_code);
    if (socketRoomCode !== currentRoom.room_code) initSocket(currentRoom.room_code);
  }

  updateUIFromState();
  return response;
}

async function patchRoomState({ gameState, status, roomSettings } = {}) {
  if (!currentRoom?.room_code) throw new Error('No hay sala activa');

  const response = await api.updateRoomState(currentRoom.room_code, { gameState, status, roomSettings });
  mergeRoomResponse(response, { gameState, status, roomSettings });
  broadcastRoomState();
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

    currentRoom = res;
    persistRoom(res.room_code);
    initSocket(res.room_code);
    renderLobby();
    feedback('success');
    setRoute('sala', { roomCode: res.room_code });
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
    currentRoom = { ...room, ...res, game_state: res.game_state || room.game_state };
    await ensureCurrentPlayerInRoom();

    persistRoom(code);
    initSocket(code);
    feedback('success');
    setRoute(routeForStatus(currentRoom.status), { roomCode: code, replace: replaceRoute });
    updateUIFromState({ skipRoute: true });
  } catch (e) {
    console.error(e);
    clearPersistedRoom();
    feedback('error');
    if (!silent) alert('No se pudo entrar en la sala');
    showLoginSubscreen('join', { roomCode: code, replaceRoute: true });
  }
}

async function refreshRoom() {
  if (!currentRoom?.room_code) return;

  try {
    const res = await api.getRoom(currentRoom.room_code);
    currentRoom = res;
    updateUIFromState();
  } catch (e) {
    console.error('No se pudo refrescar la sala', e);
  }
}

function getSocketChannel(code) {
  return `infiltrado:room:${String(code).trim().toUpperCase()}`;
}

function initSocket(code) {
  closeSocket();

  const sessionId = socketSessionId + 1;
  socketSessionId = sessionId;
  socketRoomCode = code;
  socket = connect(getSocketChannel(code));

  bindSocketEvent('player_joined', () => refreshRoom());
  bindSocketEvent('state_updated', (data) => handleRemoteStateUpdate(data, sessionId));
  bindSocketEvent('message', (message) => handleSocketMessage(message, sessionId));
  bindSocketEvent('open', () => {
    if (socketSessionId === sessionId) reconnectAttempts = 0;
  });
  bindSocketEvent('close', () => {
    if (socketSessionId === sessionId && socketRoomCode === code && currentRoom?.room_code === code) reconnectSocket(code, sessionId);
  });
  bindSocketEvent('error', (err) => {
    console.error('Socket error', err);
  });
}

function bindSocketEvent(eventName, handler) {
  if (typeof socket?.on === 'function') {
    socket.on(eventName, handler);
    return;
  }

  if (typeof socket?.addEventListener === 'function') {
    socket.addEventListener(eventName, handler);
  }
}

function normalizeSocketMessage(message) {
  const raw = message?.data ?? message;
  if (typeof raw !== 'string') return raw;

  try {
    return JSON.parse(raw);
  } catch {
    return { type: raw };
  }
}

function handleSocketMessage(message, sessionId) {
  const data = normalizeSocketMessage(message);
  if (!data || data.sender_id === currentUser?.id) return;
  if (data.room_code && data.room_code !== socketRoomCode) return;

  if (data.type === 'state_updated') {
    handleRemoteStateUpdate(data.payload || data, sessionId);
    return;
  }

  if (data.type === 'player_joined') refreshRoom();
}

function handleRemoteStateUpdate(data, sessionId) {
  const payload = normalizeSocketMessage(data);
  const roomPayload = payload?.payload || payload;

  if (!currentRoom || socketSessionId !== sessionId) return;
  if (roomPayload?.room_code && roomPayload.room_code !== currentRoom.room_code) return;

  if (!roomPayload?.game_state && !roomPayload?.status && !roomPayload?.room_settings) {
    refreshRoom();
    return;
  }

  currentRoom = {
    ...currentRoom,
    status: roomPayload.status || currentRoom.status,
    room_settings: roomPayload.room_settings || currentRoom.room_settings,
    game_state: roomPayload.game_state || currentRoom.game_state
  };
  updateUIFromState();
}

function emitSocketEvent(type, payload = {}) {
  if (!socket || !socketRoomCode) return;

  const message = {
    type,
    room_code: socketRoomCode,
    sender_id: currentUser?.id,
    payload
  };

  try {
    if (typeof socket.emit === 'function') {
      socket.emit(type, message);
    } else if (typeof socket.publish === 'function') {
      socket.publish(type, message);
    } else if (typeof socket.send === 'function') {
      socket.send(JSON.stringify(message));
    }
  } catch (error) {
    console.error('No se pudo emitir por IttySockets', error);
  }
}

function broadcastRoomState() {
  if (!currentRoom) return;

  emitSocketEvent('state_updated', {
    room_code: currentRoom.room_code,
    status: currentRoom.status,
    room_settings: currentRoom.room_settings,
    game_state: currentRoom.game_state
  });
}

function reconnectSocket(code, sessionId) {
  reconnectAttempts += 1;
  const delay = Math.min(SOCKET_RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), SOCKET_RECONNECT_MAX_MS);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (socketSessionId === sessionId && currentRoom?.room_code === code) initSocket(code);
  }, delay);
}

function updateUIFromState({ skipRoute = false } = {}) {
  const status = currentRoom?.status;
  if (!status) return;
  if (!skipRoute) setRoute(routeForStatus(status), { roomCode: currentRoom.room_code });

  if (status === 'waiting') { renderLobby(); showScreen('lobby'); }
  else if (status === 'playing') { renderGame(); showScreen('game'); }
  else if (status === 'voting') { renderVoting(); showScreen('game'); }
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
    el.querySelector('.truncate').innerText = p.name + (p.id == currentRoom.host_id ? ' (Host)' : '');
    el.querySelector('.w-12').innerText = (p.name || '?')[0].toUpperCase();
    list.appendChild(el);
  });
  const isHost = currentRoom.host_id == currentUser.id;
  document.getElementById('admin-controls').classList.toggle('hidden', !isHost);
  document.getElementById('waiting-message').classList.toggle('hidden', isHost);
}

function renderModeSummary() {
  const modeSummary = document.getElementById('mode-summary');
  const settings = currentRoom.room_settings || {};
  const mode = settings.mode || 'classic';
  const timerText = mode === 'timed' ? ` · ${settings.timerSeconds || 30}s por ronda` : '';
  const roundsText = ` · ${Number(settings.maxRounds) || 3} rondas máx.`;

  modeSummary.classList.remove('hidden');
  modeSummary.innerHTML = `<strong>${GAME_MODES[mode]?.label || 'Clásico'}</strong>${timerText}${roundsText}<br><span class="text-gray-400">${getModeDescription(mode)}</span>`;
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
  const showCat = currentRoom.room_settings.showCategory;
  if (showCat === 'all' || (showCat === 'civil' && !myData.isInfiltrado)) {
    catEl.innerText = `Categoría: ${state.category}`;
    catEl.classList.remove('hidden');
  } else {
    catEl.classList.add('hidden');
  }

  document.getElementById('player-word').innerText = myData.eliminated ? 'ELIMINADO' : (myData.word || '???');
  document.getElementById('game-status').innerText = `RONDA ${state.round || 1}/${Number(currentRoom.room_settings?.maxRounds) || 3}`;
  document.getElementById('mode-status').innerText = state.modeLabel || getModeLabel(state.mode || 'classic');
  renderTimerStatus();
  animateElement(document.getElementById('word-container'), 'glow-pulse');

  const turnList = document.getElementById('turn-list');
  turnList.innerHTML = '';
  (state.turnOrder || []).forEach(id => {
    const p = state.players.find(pl => pl.id == id);
    if (!p) return;
    const span = document.createElement('span');
    span.className = `px-3 py-1 rounded-full text-[10px] font-bold ${p.eliminated ? 'bg-gray-800 text-gray-600 line-through' : 'bg-brand/20 text-brand'}`;
    span.innerText = p.name;
    turnList.appendChild(span);
  });

  document.getElementById('word-container').classList.remove('hidden');
  document.getElementById('voting-area').classList.add('hidden');
  document.getElementById('btn-show-voting').classList.toggle('hidden', currentRoom.host_id != currentUser.id || myData.eliminated);
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
  const myData = currentRoom.game_state.players.find(p => p.id == currentUser.id);
  if (!myData) {
    clearPersistedRoom();
    showScreen('login');
    return;
  }

  document.getElementById('word-container').classList.add('hidden');
  document.getElementById('voting-area').classList.remove('hidden');
  document.getElementById('btn-show-voting').classList.add('hidden');
  document.getElementById('game-status').innerText = `VOTACIÓN ${currentRoom.game_state.round || 1}/${Number(currentRoom.room_settings?.maxRounds) || 3}`;
  document.getElementById('mode-status').innerText = currentRoom.game_state.modeLabel || getModeLabel(currentRoom.game_state.mode || 'classic');
  document.getElementById('timer-status').classList.add('hidden');

  const votes = currentRoom.game_state.votes || {};
  const hasVoted = Boolean(votes[currentUser.id]);
  const grid = document.getElementById('vote-grid');
  grid.innerHTML = '';
  currentRoom.game_state.players.forEach(p => {
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

  const info = document.createElement('p');
  info.className = 'text-center text-gray-400 mb-4';
  info.innerText = infiltrados.length
    ? `Infiltrado${infiltrados.length > 1 ? 's' : ''}: ${infiltrados.map(p => `${p.name} (${p.word || 'NADA'})`).join(', ')}`
    : 'No se encontró al infiltrado.';
  resultsList.appendChild(info);

  if (state.winnerReason) {
    const reason = document.createElement('p');
    reason.className = 'text-center text-xs text-gray-500 mb-4 uppercase tracking-widest';
    reason.innerText = state.winnerReason;
    resultsList.appendChild(reason);
  }

  [...state.players].sort((a, b) => (b.points || 0) - (a.points || 0)).forEach(p => {
    const div = document.createElement('div');
    div.className = 'flex justify-between bg-gray-900 p-4 rounded-xl';
    div.innerHTML = `<span>${p.name}</span><span class="font-bold text-brand">${p.points || 0} pts</span>`;
    resultsList.appendChild(div);
  });
}

function buildStartGamePayload(players) {
  const pairIndex = Math.floor(Math.random() * palabras.length);
  const pair = palabras[pairIndex];
  const roundState = createRoundState(players, currentRoom.room_settings, pair, palabras);

  return {
    minPlayers: MIN_PLAYERS,
    pairIndex,
    wordPair: pair,
    wordPairs: palabras,
    proposedState: {
      ...currentRoom.game_state,
      ...roundState,
      round: 1,
      votes: {},
      winner: null,
      winnerReason: null
    }
  };
}


function resolveVotingState(state, votes) {
  const voters = getAlivePlayers(state.players);

  if (Object.keys(votes).length < voters.length) {
    return {
      status: 'voting',
      gameState: { ...state, votes }
    };
  }

  const counts = {};
  Object.values(votes).forEach(id => {
    counts[id] = (counts[id] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter(id => counts[id] === maxVotes);
  const eliminatedId = tied[Math.floor(Math.random() * tied.length)];
  const players = state.players.map(player =>
    player.id == eliminatedId ? { ...player, eliminated: true } : { ...player }
  );

  let status = 'playing';
  let winner = null;
  let winnerReason = null;
  const infiltrados = players.filter(player => player.isInfiltrado);
  const infiltradosAlive = infiltrados.filter(player => !player.eliminated).length;
  const civiliansAlive = players.filter(player => !player.isInfiltrado && !player.eliminated).length;
  const round = Number(state.round) || 1;
  const maxRounds = Number(currentRoom.room_settings?.maxRounds) || 3;

  if (infiltradosAlive === 0) {
    winner = 'civiles';
    status = 'results';
    winnerReason = 'El infiltrado ha sido descubierto';
    players.filter(player => !player.isInfiltrado).forEach(player => {
      player.points = (Number(player.points) || 0) + 1;
    });
  } else if (civiliansAlive <= infiltradosAlive) {
    winner = 'infiltrado';
    status = 'results';
    winnerReason = 'Los infiltrados igualan o superan a los civiles';
    infiltrados.filter(player => !player.eliminated).forEach(player => {
      player.points = (Number(player.points) || 0) + 2;
    });
  } else if (round >= maxRounds) {
    winner = 'infiltrado';
    status = 'results';
    winnerReason = `Se alcanzó el límite de ${maxRounds} ronda${maxRounds === 1 ? '' : 's'}`;
    infiltrados.filter(player => !player.eliminated).forEach(player => {
      player.points = (Number(player.points) || 0) + 2;
    });
  }

  return {
    status,
    gameState: {
      ...state,
      players,
      votes: status === 'playing' ? {} : votes,
      winner,
      winnerReason,
      round: status === 'playing' ? round + 1 : round,
      roundStartedAt: status === 'playing' ? Date.now() : state.roundStartedAt
    }
  };
}

async function startGame() {
  feedback('click');
  const players = getPlayers();

  if (currentRoom.host_id != currentUser.id) {
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
      gameState: payload.proposedState
    });
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo comenzar la partida');
  }
}

async function goToVoting() {
  feedback('click');

  if (currentRoom.host_id != currentUser.id) {
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

async function backToLobby() {
  feedback('click');

  if (currentRoom.host_id != currentUser.id) {
    feedback('error');
    alert('Solo el host puede volver al lobby');
    return;
  }

  await createRematchRoom();
}

async function createRematchRoom() {
  const oldRoom = currentRoom;
  const players = oldRoom.game_state.players.map(player => buildLobbyPlayer(player, { isHost: player.id == oldRoom.host_id }));

  try {
    const res = await api.createRoom(GAME_ID, oldRoom.host_id, oldRoom.room_settings, {
      status: 'waiting',
      players
    });

    currentRoom = res;
    persistRoom(res.room_code);
    initSocket(res.room_code);
    feedback('success');
    setRoute('sala', { roomCode: res.room_code });
    updateUIFromState({ skipRoute: true });
    alert(`Nueva sala creada: ${res.room_code}. Comparte el enlace con el grupo.`);
  } catch (error) {
    console.error(error);
    feedback('error');
    alert('No se pudo crear una nueva sala');
  }
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
