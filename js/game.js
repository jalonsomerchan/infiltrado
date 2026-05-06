import { connect } from 'https://esm.sh/itty-sockets';
import palabras from './palabras.js';

const api = new GameAPI();
const GAME_ID = 12;

let currentUser = JSON.parse(localStorage.getItem('infiltrado_user')) || null;
let currentRoom = null;
let socket = null;
let urlRoomCode = new URLSearchParams(window.location.search).get('room');

const screens = {
  login: document.getElementById('screen-login'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results')
};

async function init() {
  if (urlRoomCode) {
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('join-container').classList.remove('hidden');
    document.getElementById('join-code').value = urlRoomCode;
  }
  if (currentUser) document.getElementById('login-username').value = currentUser.username;
  showScreen('login');
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('btn-create-init').onclick = () => {
    if (!validateUser()) return;
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('config-container').classList.remove('hidden');
  };
  document.getElementById('btn-join-init').onclick = () => {
    if (!validateUser()) return;
    document.getElementById('login-actions').classList.add('hidden');
    document.getElementById('join-container').classList.remove('hidden');
  };
  document.getElementById('btn-create-confirm').onclick = createRoom;
  document.getElementById('btn-join-confirm').onclick = () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (code) joinRoom(code);
  };
  document.getElementById('btn-start').onclick = startGame;
  document.getElementById('btn-show-voting').onclick = goToVoting;
  document.getElementById('btn-back-lobby').onclick = backToLobby;
  document.getElementById('btn-share').onclick = shareRoom;
}

function validateUser() {
    const username = document.getElementById('login-username').value.trim();
    if (!username) return alert('Pon un nombre');
    currentUser = { id: username, username };
    localStorage.setItem('infiltrado_user', JSON.stringify(currentUser));
    return true;
}

function showScreen(screenId) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenId].classList.add('active');
}

async function createRoom() {
  const settings = {
    infiltradoMode: document.getElementById('config-infiltrado-word').value,
    showCategory: document.getElementById('config-show-category').value,
    maxRounds: parseInt(document.getElementById('config-rounds').value) || 3
  };
  try {
    const res = await api.createRoom(GAME_ID, currentUser.id, settings, {
      status: 'waiting',
      players: [{ id: currentUser.id, name: currentUser.username, points: 0, isHost: true, eliminated: false }]
    });
    currentRoom = res;
    window.history.pushState({}, '', `?room=${res.room_code}`);
    initSocket(res.room_code);
    renderLobby();
    showScreen('lobby');
  } catch (e) { console.error(e); }
}

async function joinRoom(code) {
  try {
    const res = await api.joinRoom(code, currentUser.id);
    currentRoom = res;
    initSocket(code);
    refreshRoom();
  } catch (e) { location.reload(); }
}

async function refreshRoom() {
  const res = await api.getRoom(currentRoom.room_code);
  currentRoom = res;
  updateUIFromState();
}

function initSocket(code) {
  socket = connect(`wss://alon.one/juegos/api/ws/rooms/${code}`);
  socket.on('player_joined', refreshRoom);
  socket.on('state_updated', (data) => {
    currentRoom.game_state = data.game_state;
    currentRoom.status = data.status;
    updateUIFromState();
  });
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
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  (currentRoom.game_state.players || []).forEach(p => {
    const el = document.importNode(document.getElementById('tpl-player').content, true);
    el.querySelector('.truncate').innerText = p.name + (p.id == currentRoom.host_id ? ' (Host)' : '');
    el.querySelector('.w-12').innerText = p.name[0].toUpperCase();
    list.appendChild(el);
  });
  const isHost = currentRoom.host_id == currentUser.id;
  document.getElementById('admin-controls').classList.toggle('hidden', !isHost);
  document.getElementById('waiting-message').classList.toggle('hidden', isHost);
}

function renderGame() {
  const state = currentRoom.game_state;
  const myData = state.players.find(p => p.id == currentUser.id);
  
  const catEl = document.getElementById('category-display');
  const showCat = currentRoom.room_settings.showCategory;
  if (showCat === 'all' || (showCat === 'civil' && !myData.isInfiltrado)) {
      catEl.innerText = `Categoría: ${state.category}`;
      catEl.classList.remove('hidden');
  } else catEl.classList.add('hidden');

  document.getElementById('player-word').innerText = myData.eliminated ? 'ELIMINADO' : (myData.word || '???');
  document.getElementById('game-status').innerText = `RONDA ${state.round || 1}`;
  
  const turnList = document.getElementById('turn-list');
  turnList.innerHTML = '';
  state.turnOrder.forEach(id => {
      const p = state.players.find(pl => pl.id == id);
      const span = document.createElement('span');
      span.className = `px-3 py-1 rounded-full text-[10px] font-bold ${p.eliminated ? 'bg-gray-800 text-gray-600 line-through' : 'bg-brand/20 text-brand'}`;
      span.innerText = p.name;
      turnList.appendChild(span);
  });

  document.getElementById('word-container').classList.remove('hidden');
  document.getElementById('voting-area').classList.add('hidden');
  document.getElementById('btn-show-voting').classList.toggle('hidden', currentRoom.host_id != currentUser.id || myData.eliminated);
}

function renderVoting() {
    const myData = currentRoom.game_state.players.find(p => p.id == currentUser.id);
    document.getElementById('word-container').classList.add('hidden');
    document.getElementById('voting-area').classList.remove('hidden');
    document.getElementById('btn-show-voting').classList.add('hidden');
    
    const grid = document.getElementById('vote-grid');
    grid.innerHTML = '';
    currentRoom.game_state.players.forEach(p => {
        if (p.id == currentUser.id || p.eliminated) return;
        const el = document.importNode(document.getElementById('tpl-vote-card').content, true);
        const btn = el.querySelector('button');
        btn.querySelector('span').innerText = p.name;
        btn.querySelector('.w-16').innerText = p.name[0].toUpperCase();
        if (myData.eliminated) btn.classList.add('pointer-events-none', 'opacity-50');
        else btn.onclick = () => castVote(p.id);
        
        if (currentRoom.game_state.votes && currentRoom.game_state.votes[currentUser.id] == p.id) btn.classList.add('selected');
        grid.appendChild(el);
    });
}

function renderResults() {
    const state = currentRoom.game_state;
    const resultsList = document.getElementById('results-list');
    resultsList.innerHTML = '';
    const infiltrado = state.players.find(p => p.isInfiltrado);
    document.getElementById('results-winner').innerText = state.winner === 'infiltrado' ? '¡GANA EL INFILTRADO!' : '¡CIVILES GANAN!';
    const info = document.createElement('p');
    info.className = 'text-center text-gray-400 mb-4';
    info.innerText = `El infiltrado era ${infiltrado.name} con la palabra: ${infiltrado.word || 'NADA'}`;
    resultsList.appendChild(info);

    state.players.sort((a,b) => b.points - a.points).forEach(p => {
        const div = document.createElement('div');
        div.className = 'flex justify-between bg-gray-900 p-4 rounded-xl';
        div.innerHTML = `<span>${p.name}</span><span class="font-bold text-brand">${p.points} pts</span>`;
        resultsList.appendChild(div);
    });
}

async function startGame() {
    const pair = palabras[Math.floor(Math.random() * palabras.length)];
    const players = currentRoom.game_state.players;
    const infiltradoIndex = Math.floor(Math.random() * players.length);
    const order = players.map(p => p.id).sort(() => Math.random() - 0.5);

    players.forEach((p, i) => {
        p.eliminated = false;
        p.isInfiltrado = (i === infiltradoIndex);
        if (p.isInfiltrado) {
            p.word = currentRoom.room_settings.infiltradoMode === 'similar' ? pair.palabras[1] : '';
        } else {
            p.word = pair.palabras[0];
        }
    });

    await api.updateRoomState(currentRoom.room_code, {
        status: 'playing',
        gameState: { ...currentRoom.game_state, players, category: pair.categoria, turnOrder: order, round: 1, votes: {}, winner: null }
    });
}

async function goToVoting() {
    await api.updateRoomState(currentRoom.room_code, { status: 'voting', gameState: { ...currentRoom.game_state, votes: {} } });
}

async function castVote(targetId) {
    if (currentRoom.game_state.votes && currentRoom.game_state.votes[currentUser.id]) return;
    const votes = { ...currentRoom.game_state.votes, [currentUser.id]: targetId };
    const activePlayers = currentRoom.game_state.players.filter(p => !p.eliminated);
    const voters = activePlayers.filter(p => !p.eliminated); // Solo votan los vivos
    
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
        const infiltrado = players.find(p => p.isInfiltrado);
        const civiliansAlive = players.filter(p => !p.isInfiltrado && !p.eliminated).length;

        if (infiltrado.eliminated) {
            winner = 'civiles';
            status = 'results';
            players.filter(p => !p.isInfiltrado).forEach(p => p.points++);
        } else if (civiliansAlive <= 1) {
            winner = 'infiltrado';
            status = 'results';
            infiltrado.points += 2;
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
    await api.updateRoomState(currentRoom.room_code, { status: 'waiting' });
}

function shareRoom() {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: 'Infiltrado', url });
    else { navigator.clipboard.writeText(url); alert('Copiado'); }
}

init();
