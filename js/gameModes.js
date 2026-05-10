export const GAME_MODES = {
  classic: {
    label: 'Clásico',
    description: 'Un infiltrado recibe una palabra similar y el resto recibe la palabra civil.'
  },
  blind: {
    label: 'Infiltrado ciego',
    description: 'El infiltrado no recibe palabra. Tiene que improvisar y pasar desapercibido.'
  },
  double: {
    label: 'Doble infiltrado',
    description: 'En partidas grandes puede haber dos infiltrados colaborando en secreto.'
  },
  chaos: {
    label: 'Caos',
    description: 'El infiltrado recibe una palabra de otra categoría para que todo sea menos evidente.'
  },
  timed: {
    label: 'Contrarreloj',
    description: 'La ronda muestra un temporizador para que las descripciones sean rápidas.'
  }
};

export function getModeSettings(rawSettings = {}, playersCount = 0) {
  const mode = rawSettings.mode || 'classic';
  const timerSeconds = Number(rawSettings.timerSeconds) || 30;
  const infiltradosCount = mode === 'double' && playersCount >= 6 ? 2 : 1;

  return {
    ...rawSettings,
    mode,
    timerSeconds,
    infiltradosCount
  };
}

export function getModeLabel(mode) {
  return GAME_MODES[mode]?.label || GAME_MODES.classic.label;
}

export function getModeDescription(mode) {
  return GAME_MODES[mode]?.description || GAME_MODES.classic.description;
}

export function createRoundState(players, rawSettings, wordPair, allWordPairs = []) {
  const settings = getModeSettings(rawSettings, players.length);
  const shuffledPlayers = shuffle([...players]);
  const infiltradoIds = new Set(shuffledPlayers.slice(0, settings.infiltradosCount).map(player => player.id));
  const turnOrder = shuffle(players.map(player => player.id));
  const chaosPair = getChaosPair(wordPair, allWordPairs);

  const roundPlayers = players.map(player => {
    const isInfiltrado = infiltradoIds.has(player.id);
    const word = getPlayerWord({ isInfiltrado, settings, wordPair, chaosPair });

    return {
      ...player,
      eliminated: false,
      isInfiltrado,
      word
    };
  });

  return {
    players: roundPlayers,
    category: wordPair.categoria,
    mode: settings.mode,
    modeLabel: getModeLabel(settings.mode),
    modeDescription: getModeDescription(settings.mode),
    timerSeconds: settings.timerSeconds,
    roundStartedAt: Date.now(),
    turnOrder,
    round: 1,
    votes: {},
    winner: null
  };
}

function getPlayerWord({ isInfiltrado, settings, wordPair, chaosPair }) {
  if (!isInfiltrado) return wordPair.palabras[0];

  if (settings.mode === 'blind') return '';
  if (settings.mode === 'chaos') return chaosPair.palabras[0];
  if (settings.mode === 'classic' || settings.mode === 'double' || settings.mode === 'timed') {
    return settings.infiltradoMode === 'none' ? '' : wordPair.palabras[1];
  }

  return wordPair.palabras[1];
}

function getChaosPair(wordPair, allWordPairs) {
  const alternatives = allWordPairs.filter(pair => pair !== wordPair && pair.categoria !== wordPair.categoria);
  if (!alternatives.length) return wordPair;
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

function shuffle(items) {
  return items
    .map(item => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}
