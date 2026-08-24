import { calculateDerivedStats } from './matchImporter.js';
import { API_BASE_URL } from './config.js';

// Geração de IDs compatível com navegadores/contextos antigos.
export const makeId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

const cloneValue = value => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export const DEFAULT_MAPS = [
  'Dust', 'Mirage', 'Cache', 'Inferno', 'Ancient', 'Anubis', 'Cobble', 'Train (antiga)', 'Overpass'
];

export const DEFAULT_PICK_BAN_CONFIG = [
  { team: 1, type: 'BAN' },
  { team: 2, type: 'BAN' },
  { team: 1, type: 'BAN' },
  { team: 2, type: 'BAN' },
  { team: 1, type: 'PICK' },
  { team: 2, type: 'PICK' },
  { team: 1, type: 'BAN' },
  { team: 2, type: 'BAN' }
];

export const initialState = () => ({
  schemaVersion: 2,
  players: [],
  maps: DEFAULT_MAPS.map(name => ({ id: makeId(), name, image: '' })),
  pickBanConfig: cloneValue(DEFAULT_PICK_BAN_CONFIG),
  match: null,
  matches: []
});

// Regras de integridade do Elo/Level. Não altera a progressão existente;
// apenas garante o limite inferior absoluto de Elo e Level.
export function normalizePlayerElo(player) {
  const raw = Number(player.points);
  player.points = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  // O Level é sempre derivado do Elo. Assim não existem divergências entre
  // ranking, card, perfil e histórico. Level 0 é o limite absoluto.
  player.level = Math.floor(player.points / 100);
  if (player.points === 0) player.level = 0;
  return player;
}

export function newPlayerDefaults() {
  return { level: 5, points: 500 };
}

export function levelFromElo(elo) {
  const value = Math.max(0, Math.floor(Number(elo) || 0));
  return value === 0 ? 0 : Math.floor(value / 100);
}

export function calculateEloDelta(kda, won) {
  const value = Number.isFinite(Number(kda)) ? Number(kda) : 0;
  if (won === null || won === undefined) return 0;
  if (won) {
    if (value <= 0.7) return 19;
    if (value <= 1.0) return 20;
    if (value <= 1.2) return 21;
    return 22;
  }
  if (value <= 0.7) return -22;
  if (value <= 1.0) return -20;
  if (value <= 1.3) return -19;
  return -18;
}

function migrate(raw) {
  const state = raw && typeof raw === 'object' ? raw : initialState();
  state.schemaVersion = 2;

  // Normaliza instalações antigas para impedir erros de inicialização/tela branca.
  if (!Array.isArray(state.players)) state.players = [];
  if (!Array.isArray(state.maps) || state.maps.length === 0) {
    state.maps = DEFAULT_MAPS.map(name => ({ id: makeId(), name, image: '' }));
  } else {
    state.maps = state.maps.filter(Boolean).map(m => ({
      id: m.id || makeId(),
      name: m.name || 'Mapa',
      image: m.image || ''
    }));
  }
  if (!Array.isArray(state.pickBanConfig) || state.pickBanConfig.length === 0) {
    state.pickBanConfig = cloneValue(DEFAULT_PICK_BAN_CONFIG);
  }
  if (!Array.isArray(state.matches)) state.matches = [];

  if (state.match && typeof state.match === 'object') {
    state.match.selectedPlayerIds ||= [];
    state.match.captainIds ||= [];
    state.match.teams ||= { a: [], b: [] };
    state.match.teams.a ||= [];
    state.match.teams.b ||= [];
    state.match.draft ||= { round: 0, picks: [], available: [], currentCaptainId: null, pickCount: 0 };
    state.match.draft.picks ||= [];
    state.match.draft.available ||= [];
    state.match.pickBan ||= { index: 0, actions: [], remainingMapIds: [], complete: false };
    state.match.pickBan.actions ||= [];
    state.match.pickBan.remainingMapIds ||= [];
    state.match.history ||= [];
  }

  for (const p of state.players) {
    p.stats ||= {};
    p.steamId ||= p.steamID64 || p.steamid64 || null;
    p.steamId3 ||= null;
    p.registeredName ||= p.name || '';
    normalizePlayerElo(p);
  }
  return state;
}

export async function loadState() {
  const response = await fetch(`${API_BASE_URL}/api/state`);
  if (response.status === 404) return { state: initialState(), version: null };
  if (!response.ok) throw new Error('Não foi possível carregar os dados do servidor.');
  const payload = await response.json();
  return { state: migrate(payload.data), version: payload.version };
}

export async function saveState(state, version = null) {
  const response = await fetch(`${API_BASE_URL}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: state, version })
  });
  if (response.status === 409) throw new Error('Os dados foram alterados em outra sessão. Recarregue a página.');
  if (!response.ok) throw new Error('Não foi possível salvar os dados no servidor.');
  return response.json();
}

export function newMatch() {
  return {
    id: makeId(),
    status: 'selection',
    selectedPlayerIds: [],
    captainIds: [],
    firstCaptainId: null,
    teams: { a: [], b: [] },
    draft: { round: 0, picks: [], available: [], currentCaptainId: null, pickCount: 0 },
    pickBan: { index: 0, actions: [], remainingMapIds: [], complete: false },
    history: [],
    createdAt: new Date().toISOString()
  };
}

export const statusLabels = {
  selection: 'Seleção de jogadores',
  captains: 'Seleção dos capitães',
  draw: 'Sorteio',
  draft: 'Draft',
  teams_confirmed: 'Times confirmados',
  pickban: 'Pick & Ban',
  ready: 'Partida pronta',
  finished: 'Partida finalizada'
};

export const draftRounds = [{ count: 1 }, { count: 2 }, { count: 2 }, { count: 2 }, { count: 1 }];

export function playerById(state, id) { return state.players.find(p => p.id === id); }

export function findPlayerBySteamId(state, steamId) {
  const value = String(steamId ?? '').trim();
  if (!value) return null;
  const aliases = new Set([value]);
  if (/^\d+$/.test(value)) {
    try {
      const n = BigInt(value);
      const base = 76561197960265728n;
      if (n < base) aliases.add(String(base + n));
      else aliases.add(String(n - base));
    } catch {}
  }
  return state.players.find(p => {
    const ids = [p.steamId, p.steamId64, p.steamID64, p.steamId3]
      .map(x => String(x || '').trim()).filter(Boolean);
    return ids.some(id => aliases.has(id));
  }) || null;
}

export function captainTeamKey(match, captainId) { return match.captainIds[0] === captainId ? 'a' : 'b'; }

export function startDraft(state) {
  const m = cloneValue(state.match);
  if (m.selectedPlayerIds.length !== 10) throw new Error('É necessário selecionar exatamente 10 jogadores.');
  if (m.captainIds.length !== 2) throw new Error('É necessário selecionar exatamente 2 capitães.');
  if (!m.firstCaptainId) throw new Error('É necessário realizar o sorteio.');
  m.status = 'draft';
  m.draft.available = m.selectedPlayerIds.filter(id => !m.captainIds.includes(id));
  m.draft.round = 0;
  m.draft.currentCaptainId = m.firstCaptainId;
  m.draft.pickCount = draftRounds[0].count;
  return { ...state, match: m };
}

export function draftPick(state, playerId) {
  const m = cloneValue(state.match);
  if (m.status !== 'draft') throw new Error('O Draft não está ativo.');
  if (!m.draft.available.includes(playerId)) throw new Error('Jogador indisponível ou já escolhido.');
  const expected = draftRounds[m.draft.round];
  if (!expected) throw new Error('Draft concluído.');
  const currentSlot = m.captainIds.indexOf(m.draft.currentCaptainId);
  const team = currentSlot === 0 ? 'a' : 'b';
  m.teams[team].push(playerId);
  m.draft.available = m.draft.available.filter(id => id !== playerId);
  const at = new Date().toISOString();
  m.draft.picks.push({ playerId, captainId: m.draft.currentCaptainId, round: m.draft.round + 1, at });
  m.history.push({ type: 'DRAFT', playerId, captainId: m.draft.currentCaptainId, round: m.draft.round + 1, at });
  m.draft.pickCount -= 1;

  if (m.draft.pickCount > 0) return { ...state, match: m };
  m.draft.round += 1;
  if (m.draft.round >= draftRounds.length) {
    if (m.teams.a.length !== 4 || m.teams.b.length !== 4) throw new Error('Erro de integridade: o Draft não formou dois times de 4.');
    m.status = 'teams_confirmed';
    m.draft.currentCaptainId = null;
    m.draft.pickCount = 0;
  } else {
    const next = draftRounds[m.draft.round];
    const nextSlot = m.captainIds.indexOf(m.firstCaptainId) === 0
      ? (m.draft.round % 2 === 0 ? 0 : 1)
      : (m.draft.round % 2 === 0 ? 1 : 0);
    m.draft.currentCaptainId = m.captainIds[nextSlot];
    m.draft.pickCount = next.count;
  }
  return { ...state, match: m };
}

export function confirmTeams(state) {
  const m = cloneValue(state.match);
  if (m.status !== 'teams_confirmed') throw new Error('Os times ainda não estão prontos para confirmação.');
  if (m.teams.a.length !== 4 || m.teams.b.length !== 4) throw new Error('Cada time deve ter 4 jogadores além do capitão.');
  m.status = 'pickban';
  m.pickBan.index = 0;
  m.pickBan.actions = [];
  m.pickBan.remainingMapIds = state.maps.map(x => x.id);
  m.pickBan.complete = false;
  return { ...state, match: m };
}

export function doPickBan(state, mapId, actorId) {
  const m = cloneValue(state.match);
  if (m.status !== 'pickban') throw new Error('Pick & Ban não está ativo.');
  const step = state.pickBanConfig[m.pickBan.index];
  if (!step) throw new Error('A sequência do Pick & Ban terminou ou não foi configurada.');
  if (!m.pickBan.remainingMapIds.includes(mapId)) throw new Error('Este mapa não está disponível.');
  if (!actorId || !m.captainIds.includes(actorId)) throw new Error('A ação deve ser realizada por um capitão.');
  const expectedTeam = m.captainIds[step.team === 1 ? 0 : 1];
  if (actorId !== expectedTeam) throw new Error('Não é a vez deste time.');
  const map = state.maps.find(x => x.id === mapId);
  if (!map) throw new Error('Mapa inexistente.');
  const at = new Date().toISOString();
  const action = { team: step.team, type: step.type, mapId, mapName: map.name, actorId, at };
  m.pickBan.actions.push(action);
  m.history.push({ type: step.type, team: step.team, mapId, mapName: map.name, actorId, at });
  m.pickBan.remainingMapIds = m.pickBan.remainingMapIds.filter(id => id !== mapId);
  m.pickBan.index += 1;
  if (m.pickBan.index >= state.pickBanConfig.length) {
    m.pickBan.complete = true;
    m.status = 'ready';
  }
  return { ...state, match: m };
}

/**
 * Recalcula as estatísticas acumuladas a partir do histórico de partidas.
 * Isso evita que exclusão/reprocessamento deixe contadores órfãos.
 */
export function rebuildPlayerStats(state) {
  const totals = new Map(state.players.map(p => [p.id, {
    matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0,
    headshots: 0, damage: 0, rounds: 0, mvps: 0, score: 0, ratingSum: 0,
    ratingCount: 0, clutches: 0, entryKills: 0, entryDeaths: 0,
    multikills: 0, flashAssists: 0, utilityDamage: 0, roundsWon: 0, roundsLost: 0
  }]));

  // As partidas são a fonte única de verdade. Reproduzimos o Elo desde o
  // valor inicial de 500 para cada jogador e gravamos o resultado em cada
  // entrada da partida, tornando o histórico auditável e persistente.
  const eloByPlayer = new Map(state.players.map(p => [p.id, 500]));
  const orderedMatches = [...(state.matches || [])].sort((a, b) =>
    new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a.id || '').localeCompare(String(b.id || ''))
  );

  for (const match of orderedMatches) {
    for (const entry of match.players || []) {
      const playerId = entry.playerId;
      if (!eloByPlayer.has(playerId)) continue;
      const raw = entry.stats || {};
      const derived = calculateDerivedStats(raw);
      const hasKdaData = ['kills','deaths','assists'].some(key => raw[key] !== undefined && raw[key] !== null && raw[key] !== '');
      const kda = Number(derived.kda) || 0;
      const won = match.winnerTeam ? Number(match.winnerTeam) === Number(entry.team) : null;
      const before = eloByPlayer.get(playerId);
      const delta = hasKdaData ? calculateEloDelta(kda, won) : 0;
      const after = Math.max(0, before + delta);
      const levelBefore = levelFromElo(before);
      const levelAfter = levelFromElo(after);
      entry.stats = { ...raw, ...derived, kda };
      entry.eloBefore = before;
      entry.eloDelta = delta;
      entry.eloAfter = after;
      entry.levelBefore = levelBefore;
      entry.levelAfter = levelAfter;
      entry.result = !hasKdaData ? 'no-stats' : (won === null ? 'draw' : won ? 'win' : 'loss');
      eloByPlayer.set(playerId, after);
    }
  }

  for (const p of state.players) {
    const elo = eloByPlayer.get(p.id) ?? 500;
    p.points = Math.max(0, Math.floor(elo));
    p.level = levelFromElo(p.points);
    p.eloHistory = orderedMatches.flatMap(match => (match.players || [])
      .filter(entry => entry.playerId === p.id)
      .map(entry => ({
        matchId: match.id,
        date: match.createdAt,
        result: entry.result,
        kills: Number(entry.stats?.kills) || 0,
        deaths: Number(entry.stats?.deaths) || 0,
        assists: Number(entry.stats?.assists) || 0,
        kda: Number(entry.stats?.kda) || 0,
        eloBefore: Number(entry.eloBefore) || 0,
        eloDelta: Number(entry.eloDelta) || 0,
        eloAfter: Number(entry.eloAfter) || 0,
        levelBefore: Number(entry.levelBefore) || 0,
        levelAfter: Number(entry.levelAfter) || 0
      }))
    );

    const t = totals.get(p.id);
    if (!t) continue;
    for (const match of state.matches || []) {
      const entry = (match.players || []).find(x => x.playerId === p.id);
      if (!entry) continue;
      const raw = entry.stats || {};
      const s = { ...raw, ...calculateDerivedStats(raw) };
      t.matches += 1;
      const won = Number(match.winnerTeam) === Number(entry.team);
      if (match.winnerTeam) won ? t.wins++ : t.losses++;
      for (const k of ['kills','deaths','assists','headshots','damage','mvps','score','clutches','entryKills','entryDeaths','multikills','flashAssists','utilityDamage']) {
        t[k] += Number(s[k]) || 0;
      }
      const rounds = Number(s.rounds ?? match.rounds) || 0;
      t.rounds += rounds;
      const roundsWon = Number(s.roundsWon);
      const roundsLost = Number(s.roundsLost);
      if (Number.isFinite(roundsWon)) t.roundsWon += roundsWon;
      if (Number.isFinite(roundsLost)) t.roundsLost += roundsLost;
      if (s.rating !== undefined && Number.isFinite(Number(s.rating)) && Number(s.rating) > 0) {
        t.ratingSum += Number(s.rating); t.ratingCount++;
      }
    }
    const kd = t.deaths ? t.kills / t.deaths : t.kills;
    const kda = t.deaths ? (t.kills + t.assists) / t.deaths : t.kills + t.assists;
    const hsPercent = t.kills ? (t.headshots / t.kills) * 100 : 0;
    const adr = t.rounds ? t.damage / t.rounds : 0;
    const rating = t.ratingCount ? t.ratingSum / t.ratingCount : 0;
    p.stats = {
      ...t, kd, kda, hsPercent, adr,
      winrate: t.matches ? (t.wins / t.matches) * 100 : 0,
      rating
    };
  }
  return state;
}

export function matchFingerprint(match) {
  const players = (match.players || []).map(p => p.steamId || p.playerId).sort().join(',');
  const score = match.score ? `${match.score.team1}-${match.score.team2}` : '';
  return [match.externalId || match.id || '', match.createdAt || '', match.map || '', score, players].join('|').toLowerCase();
}

export function isDuplicateMatch(state, candidate) {
  const fp = matchFingerprint(candidate);
  return (state.matches || []).some(m => (m.fingerprint || matchFingerprint(m)) === fp);
}
