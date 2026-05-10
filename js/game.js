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

let currentUser = JSON.parse(localStorage.getItem(USER_STORAGE_KEY)) || null;
let currentRoom = null;
let socket = null;
let socketRoomCode = null;
let reconnectAttempts = 0;
let manualSocketClose = false;
let audioContext = null;
let timerInterval = null;
let urlRoomCode = new URLSearchParams(window.location.search).get('room');

const screens = {
  login: document.getElementById('screen-login'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results')
};

async function init() {
  setupEventListeners();
  updateModeConfigUI();

  const savedRoomCode = localStorage.getItem(ROOM_STORAGE_KEY);
  const initialRoomCode = urlRoomCode || savedRoomCode;

  if (initialRoomCode) {
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('join-container').classList.remove('hidden');
    document.getElementById('join-code').value = initialRoomCode;
  }

  if (currentUser) {
    document.getElementById('login-username').value = currentUser.username;

    if (initialRoomCode) {
      await joinRoom(initialRoomCode, { silent: true });
      return;
    }
  }

  showScreen('login');
}

function setupEventListeners() {
  document.getElementById('btn-create-init').onclick = () => {
    feedback('click');
    if (!validateUser()) return;
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('config-container').classList.remove('hidden');
  };
  document.getElementById('btn-join-init').onclick = () => {
    feedback('click');
    if (!validateUser()) return;
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('join-container').classList.remove('hidden');
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
  Object.values(screens).forEach(s => {
    s.classList.remove('active', 'screen-enter');
  });

  if (screenId !== 'game') stopTimer();
  screens[screenId].classList.add('active', 'screen-enter');
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

async function ensureCurrentPlayerInRoom() {
  const players = getPlayers();
  const existingPlayer = players.find(player => player.id === currentUser.id);

  if (existingPlayer?.name === currentUser.username) return;

  const updatedPlayers = existingPlayer
    ? players.map(player => player.id === currentUser.id ? { ...player, name: currentUser.username } : player)
    : [...players, buildCurrentPlayer()];

  await api.updateRoomState(currentRoom.room_code, {
    gameState: {
      ...currentRoom.game_state,
      players: updatedPlayers
    }
  });

  currentRoom.game_state.players = updatedPlayers;
}

function persistRoom(roomCode) {
  localStorage.setItem(ROOM_STORAGE_KEY, roomCode);
  window.history.replaceState({}, '', `?room=${roomCode}`);
}

function clearPersistedRoom() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
  window.history.replaceState({}, '', window.location.pathname);
}

function getRoomUrl() {
  return `${window.location.origin}${window.location.pathname}?room=${currentRoom.room_code}`;
}

function getShareText() {
  return `Únete a mi partida de Infiltrado 🔥 Código: ${currentRoom.room_code} ${getRoomUrl()}`;
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

  return {
    mode,
    modeLabel: getModeLabel(mode),
    modeDescription: getModeDescription(mode),
    timerSeconds: parseInt(document.getElementById('config-timer').value, 10) || 30,
    infiltradoMode: mode === 'blind' ? 'none' : document.getElementById('config-infiltrado-word').value,
    showCategory: document.getElementById('config-show-category').value,
    maxRounds: parseInt(document.getElementById('config-rounds').value, 10) || 3
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
    showScreen('lobby');
  } catch (e) {
    console.error(e);
    feedback('error');
    alert('No se pudo crear la sala');
  }
}

async function joinRoom(code, { silent = false } = {}) {
  try {
    const room = await api.getRoom(code);

    if (hasDuplicatedName(room.game_state?.players || [], currentUser.username)) {
      feedback('error');
      alert('Ya hay un jugador con ese nombre en la sala');
      showScreen('login');
      return;
    }

    const res = await api.joinRoom(code, currentUser.id);
    currentRoom = { ...room, ...res, game_state: res.game_state || room.game_state };
    await ensureCurrentPlayerInRoom();

    persistRoom(code);
    initSocket(code);
    feedback('success');
    updateUIFromState();
  } catch (e) {
    console.error(e);
    clearPersistedRoom();
    feedback('error');
    if (!silent) alert('No se pudo entrar en la sala');
    showScreen('login');
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

function initSocket(code) {
  manualSocketClose = true;
  if (socket?.close) socket.close();

  manualSocketClose = false;
  socketRoomCode = code;
  socket = connect(`wss://alon.one/juegos/api/ws/rooms/${code}`);

  socket.on('player_joined', refreshRoom);
  socket.on('state_updated', (data) => {
    currentRoom.game_state = data.game_state;
    currentRoom.status = data.status;
    updateUIFromState();
  });
  socket.on('open', () => {
    reconnectAttempts = 0;
  });
  socket.on('close', () => {
    if (!manualSocketClose && socketRoomCode === code) reconnectSocket(code);
  });
  socket.on('error', (err) => {
    console.error('Socket error', err);
  });
}

function reconnectSocket(code) {
  reconnectAttempts += 1;
  const delay = Math.min(SOCKET_RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), SOCKET_RECONNECT_MAX_MS);

  setTimeout(() => {
    if (currentRoom?.room_code === code) initSocket(code);
  }, delay);
}

function updateUIFromState() {
  const status = currentRoom.status;
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
    el.querySelector('.w-12').innerText = p.name[0].toUpperCase();
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

  modeSummary.classList.remove('hidden');
  modeSummary.innerHTML = `<strong>${GAME_MODES[mode]?.label || 'Clásico'}</strong>${timerText}<br><span class="text-gray-400">${getModeDescription(mode)}</span>`;
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
  } else catEl.classList.add('hidden');

  document.getElementById('player-word').innerText = myData.eliminated ? 'ELIMINADO' : (myData.word || '???');
  document.getElementById('game-status').innerText = `RONDA ${state.round || 1}`;
  document.getElementById('mode-status').innerText = state.modeLabel || getModeLabel(state.mode || 'classic');
  renderTimerStatus();
  animateElement(document.getElementById('word-container'), 'glow-pulse');

  const turnList = document.getElementById('turn-list');
  turnList.innerHTML = '';
  state.turnOrder.forEach(id => {
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

  if (!isTimed) return;

  const updateTimer = () => {
    const elapsed = Math.floor((Date.now() - (state.roundStartedAt || Date.now())) / 1000);
    const remaining = Math.max((state.timerSeconds || 30) - elapsed, 0);
    timerStatus.innerText = `${remaining}s`;
    if (remaining === 0) feedback('reveal');
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
    document.getElementById('mode-status').innerText = currentRoom.game_state.modeLabel || getModeLabel(currentRoom.game_state.mode || 'classic');
    document.getElementById('timer-status').classList.add('hidden');

    const grid = document.getElementById('vote-grid');
    grid.innerHTML = '';
    currentRoom.game_state.players.forEach(p => {
        if (p.id == currentUser.id || p.eliminated) return;
        const el = document.importNode(document.getElementById('tpl-vote-card').content, true);
        const btn = el.querySelector('button');
        btn.querySelector('span').innerText = p.name;
        btn.querySelector('.w-16').innerText = p.name[0].toUpperCase();
        if (myData.eliminated) btn.classList.add('pointer-events-none', 'opacity-50');
        else btn.onclick = () => castVote(p.id, btn);

        if (currentRoom.game_state.votes && currentRoom.game_state.votes[currentUser.id] == p.id) btn.classList.add('selected');
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

    [...state.players].sort((a,b) => b.points - a.points).forEach(p => {
        const div = document.createElement('div');
        div.className = 'flex justify-between bg-gray-900 p-4 rounded-xl';
        div.innerHTML = `<span>${p.name}</span><span class="font-bold text-brand">${p.points} pts</span>`;
        resultsList.appendChild(div);
    });
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

    const pair = palabras[Math.floor(Math.random() * palabras.length)];
    const roundState = createRoundState(players, currentRoom.room_settings, pair, palabras);

    await api.updateRoomState(currentRoom.room_code, {
        status: 'playing',
        gameState: { ...currentRoom.game_state, ...roundState }
    });
}

async function goToVoting() {
    feedback('click');

    if (currentRoom.host_id != currentUser.id) {
      feedback('error');
      alert('Solo el host puede iniciar la votación');
      return;
    }

    await api.updateRoomState(currentRoom.room_code, { status: 'voting', gameState: { ...currentRoom.game_state, votes: {} } });
}

async function castVote(targetId, button) {
    if (currentRoom.game_state.votes && currentRoom.game_state.votes[currentUser.id]) return;
    feedback('vote');
    button?.classList.add('selected');

    const votes = { ...currentRoom.game_state.votes, [currentUser.id]: targetId };
    const voters = currentRoom.game_state.players.filter(p => !p.eliminated); // Solo votan los vivos

    if (Object.keys(votes).length >= voters.length) {
        const counts = {};
        Object.values(votes).forEach(v => counts[v] = (counts[v] || 0) + 1);
        const maxVotes = Math.max(...Object.values(counts));
        const tied = Object.keys(counts).filter(id => counts[id] === maxVotes);
        const eliminatedId = tied[Math.floor(Math.random() * tied.length)];

        const players = currentRoom.game_state.players;
        const target = players.find(p => p.id == eliminatedId);
        target.eliminated = true;

        let status = 'playing';
        let winner = null;
        const infiltrados = players.filter(p => p.isInfiltrado);
        const infiltradosAlive = infiltrados.filter(p => !p.eliminated).length;
        const civiliansAlive = players.filter(p => !p.isInfiltrado && !p.eliminated).length;

        if (infiltradosAlive === 0) {
            winner = 'civiles';
            status = 'results';
            players.filter(p => !p.isInfiltrado).forEach(p => p.points++);
        } else if (civiliansAlive <= infiltradosAlive) {
            winner = 'infiltrado';
            status = 'results';
            infiltrados.filter(p => !p.eliminated).forEach(p => p.points += 2);
        }

        await api.updateRoomState(currentRoom.room_code, {
            status,
            gameState: { ...currentRoom.game_state, players, votes, winner, round: status === 'playing' ? currentRoom.game_state.round + 1 : currentRoom.game_state.round }
        });
    } else {
        await api.updateRoomState(currentRoom.room_code, { gameState: { ...currentRoom.game_state, votes } });
    }
}

async function backToLobby() {
    feedback('click');

    if (currentRoom.host_id != currentUser.id) {
      feedback('error');
      alert('Solo el host puede volver al lobby');
      return;
    }

    await api.updateRoomState(currentRoom.room_code, { status: 'waiting' });
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
