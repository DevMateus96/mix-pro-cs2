// MIX PRO — importador real de partidas MatchZy / Valve backup.
// Aceita o ZIP gerado pelo servidor, agrupa os arquivos pelo matchid e usa
// o último round disponível como snapshot final das estatísticas acumuladas.

const STAT_KEYS = [
  'kills','deaths','assists','headshots','adr','mvps','score','rating',
  'rounds','roundsWon','roundsLost','clutches','entryKills','entryDeaths',
  'multikills','flashAssists','damage','utilityDamage'
];

const STEAM64_BASE = 76561197960265728n;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function steam64FromAccountId(id) {
  const raw = String(id ?? '').trim();
  if (!/^\d+$/.test(raw)) return raw;
  try {
    const n = BigInt(raw);
    // MatchZy/Valve backup usa account-id numérico de 32 bits nas chaves
    // PlayersOnTeam1/PlayersOnTeam2. Convertê-lo permite casar com SteamID64.
    return String(STEAM64_BASE + n);
  } catch {
    return raw;
  }
}

function decodeJsonRound(text) {
  try { return JSON.parse(text); }
  catch { throw new Error('Um dos arquivos JSON do ZIP está inválido.'); }
}

function tokenizeValveBackup(text) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{' || c === '}') { tokens.push(c); i++; continue; }
    if (c === '"') {
      i++;
      let out = '';
      while (i < text.length) {
        const ch = text[i++];
        if (ch === '"') break;
        if (ch === '\\' && i < text.length) {
          const esc = text[i++];
          out += ({ n:'\n', r:'\r', t:'\t', '\\':'\\', '"':'"' }[esc] ?? esc);
        } else out += ch;
      }
      tokens.push(out);
      continue;
    }
    // Valve backup normalmente é totalmente quoted, mas aceitar tokens crus
    // deixa o parser mais tolerante a variações futuras.
    let j = i;
    while (j < text.length && !/\s/.test(text[j]) && text[j] !== '{' && text[j] !== '}') j++;
    tokens.push(text.slice(i, j));
    i = j;
  }
  return tokens;
}

function parseValveObject(text) {
  const t = tokenizeValveBackup(text);
  let pos = 0;
  function object() {
    const out = {};
    while (pos < t.length && t[pos] !== '}') {
      const key = t[pos++];
      if (t[pos] === '{') {
        pos++;
        out[key] = object();
      } else {
        out[key] = t[pos++] ?? '';
      }
    }
    if (t[pos] === '}') pos++;
    return out;
  }
  return object();
}

function totalsFromPlayer(p) {
  const totals = p?.MatchStats?.Totals || {};
  const get = (key, fallbackKey) => num(totals[key] ?? p?.[fallbackKey]);
  const stats = {
    kills: get('Kills', 'kills'),
    deaths: get('Deaths', 'deaths'),
    assists: get('Assists', 'assists'),
    headshots: get('HeadshotKills', 'enemyHSs'),
    damage: get('Damage', 'enemyDamageDealt'),
    mvps: get('MVPs', 'mvps'),
    score: get('Score', 'score'),
    roundsWon: num(p?.roundsWon),
    clutches: num(totals['1v1Wins']) + num(totals['1v2Wins']),
    entryKills: num(totals.EntryWins),
    entryDeaths: 0,
    multikills: num(p?.enemy2Ks) + num(p?.enemy3Ks) + num(p?.enemy4Ks) + num(p?.enemy5Ks),
    flashAssists: 0,
    utilityDamage: get('UtilityDamage', 'utilityDamage')
  };
  return stats;
}

export function parseMatchzyRound(roundData) {
  if (!roundData || typeof roundData !== 'object') throw new Error('Round MatchZy inválido.');
  const backup = String(roundData.valve_backup || '');
  if (!backup) throw new Error(`O round ${roundData.round ?? '?'} não possui valve_backup.`);

  const parsed = parseValveObject(backup)?.SaveFile;
  if (!parsed) throw new Error(`Não foi possível interpretar o valve_backup do round ${roundData.round ?? '?'}.`);

  const teams = [];
  for (const [section, teamNo] of [['PlayersOnTeam1', 1], ['PlayersOnTeam2', 2]]) {
    const players = Object.entries(parsed[section] || {}).map(([accountId, p]) => ({
      accountId,
      steamId: steam64FromAccountId(accountId),
      nickname: String(p?.name || '').trim() || `PLAYER_${accountId}`,
      stats: totalsFromPlayer(p)
    }));
    teams.push({
      id: teamNo,
      name: teamNo === 1 ? String(roundData.team1_name || `Time ${teamNo}`) : String(roundData.team2_name || `Time ${teamNo}`),
      side: teamNo === 1 ? String(roundData.team1_side || '') : String(roundData.team2_side || ''),
      players
    });
  }

  const score = {
    team1: num(roundData.team1_score),
    team2: num(roundData.team2_score)
  };

  return {
    matchId: String(roundData.matchid ?? ''),
    timestamp: String(roundData.timestamp || ''),
    map: String(roundData.map_name || '').replace(/^de_/, ''),
    round: num(roundData.round),
    score,
    teams,
    source: roundData
  };
}

function aggregateRounds(rounds) {
  if (!rounds.length) throw new Error('Nenhum round válido foi encontrado no ZIP.');
  const sorted = [...rounds].sort((a,b) => a.round - b.round || a.timestamp.localeCompare(b.timestamp));
  const last = sorted[sorted.length - 1];

  // Preferir o snapshot final. Os arquivos do MatchZy já acumulam os Totals
  // no último round, portanto não somamos os rounds para evitar duplicação.
  const playedRounds = Math.max(
    num(last.score?.team1) + num(last.score?.team2),
    num(last.round),
    0
  );
  const players = last.teams.flatMap((team, teamIndex) =>
    team.players.map(p => ({
      ...p,
      team: teamIndex + 1,
      stats: {
        ...p.stats,
        rounds: playedRounds,
        roundsLost: Math.max(0, playedRounds - num(p.stats.roundsWon))
      }
    }))
  );

  const teams = last.teams.map(team => ({
    id: team.id,
    name: team.name,
    players: team.players.map(p => ({
      steamId: p.steamId,
      steamId3: null,
      nickname: p.nickname,
      stats: {
        ...p.stats,
        rounds: playedRounds,
        roundsLost: Math.max(0, playedRounds - num(p.stats.roundsWon))
      }
    }))
  }));

  return {
    match: {
      id: last.matchId || null,
      externalId: last.matchId || null,
      date: toIso(last.timestamp) || new Date().toISOString(),
      map: last.map || null,
      score: last.score,
      winnerTeam: last.score.team1 === last.score.team2 ? null : (last.score.team1 > last.score.team2 ? 1 : 2),
      rounds: playedRounds,
      teams
    },
    // Mantido para auditoria e para a tela de dados brutos.
    source: {
      format: 'MatchZy ZIP',
      matchId: last.matchId,
      rounds: playedRounds,
      files: sorted.map(r => r.source)
    }
  };
}

function toIso(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  // Os logs não carregam offset. Mantemos o horário local do navegador de forma
  // explícita, evitando alterar o dia da partida por conversão UTC.
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}


function parseCsvLine(line) {
  const out=[]; let cur=''; let q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"') { if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; }
    else if(c===',' && !q){out.push(cur);cur='';}
    else cur+=c;
  }
  out.push(cur); return out;
}
export function parseMatchCsv(text) {
  const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
  if(lines.length<2) throw new Error('CSV vazio ou sem jogadores.');
  const headers=parseCsvLine(lines[0]).map(h=>h.trim());
  const rows=lines.slice(1).map(parseCsvLine).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])));
  if(!headers.includes('steamid64') || !headers.includes('team') || !headers.includes('name')) throw new Error('CSV incompatível: são necessárias as colunas steamid64, team e name.');
  const matchId=rows[0]?.matchid || null;
  const mapNumber=rows[0]?.mapnumber || '0';
  const teamNames=[...new Set(rows.map(r=>r.team).filter(Boolean))];
  if(teamNames.length!==2) throw new Error(`O CSV precisa conter exatamente 2 times. Encontrados: ${teamNames.length}.`);
  const n=k=>Number(k)||0;
  const teams=teamNames.map((teamName,idx)=>({id:idx+1,name:teamName,players:rows.filter(r=>r.team===teamName).map(r=>({
    steamId:r.steamid64,nickname:r.name,stats:{kills:n(r.kills),deaths:n(r.deaths),assists:n(r.assists),headshots:n(r.head_shot_kills),damage:n(r.damage),utilityDamage:n(r.utility_damage),entryKills:n(r.entry_wins),entryDeaths:Math.max(0,n(r.entry_count)-n(r.entry_wins)),clutches:n(r.v1_wins)+n(r.v2_wins),multikills:n(r.enemy2ks)+n(r.enemy3ks)+n(r.enemy4ks)+n(r.enemy5ks),flashAssists:n(r.flash_successes),rounds:0,roundsWon:0,roundsLost:0}
  }))}));
  const players=teams.flatMap((t,i)=>t.players.map(p=>({...p,team:i+1})));
  return validateNormalizedMatch({match:{id:`csv-${matchId||Date.now()}-${mapNumber}`,externalId:`csv-${matchId||Date.now()}-${mapNumber}`,map:null,score:null,winnerTeam:null,rounds:0,teams,players},source:{format:'CSV',matchId,mapNumber,headers,rows}});
}

export function parseMatchImport(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('Cole os dados da partida antes de processar.');
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('JSON inválido. Para o ZIP MatchZy, use o botão Selecionar ZIP.'); }
  return validateNormalizedMatch(data);
}

export function validateNormalizedMatch(data) {
  const match = data?.match || data;
  if (!match || typeof match !== 'object') throw new Error('Dados de partida inválidos.');
  if (!Array.isArray(match.teams) || match.teams.length !== 2) {
    throw new Error('A importação exige exatamente dois times.');
  }
  const teams = match.teams.map((team, index) => {
    if (!Array.isArray(team.players)) throw new Error(`Time ${index + 1} não possui jogadores.`);
    return {
      id: team.id ?? index + 1,
      name: team.name ?? `Time ${index + 1}`,
      players: team.players.map((p, i) => normalizePlayer(p, index, i))
    };
  });
  const players = teams.flatMap((team, teamIndex) =>
    team.players.map(player => ({ ...player, team: teamIndex + 1 }))
  );
  const ids = players.map(p => p.steamId).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Existem SteamIDs duplicados dentro da partida.');
  const score = normalizeScore(match.score);
  const winnerTeam = Number(match.winnerTeam ?? match.winner ?? 0) || null;
  if (winnerTeam !== null && ![1,2].includes(winnerTeam)) throw new Error('winnerTeam deve ser 1 ou 2.');
  return {
    id: String(match.id ?? '').trim() || null,
    externalId: String(match.externalId ?? match.matchId ?? '').trim() || null,
    createdAt: match.date || match.startedAt || new Date().toISOString(),
    map: match.map ? String(match.map) : null,
    score,
    winnerTeam,
    duration: match.duration ?? null,
    rounds: Number(match.rounds ?? ((score?.team1 ?? 0) + (score?.team2 ?? 0))) || 0,
    teams,
    players,
    source: data
  };
}

function normalizePlayer(p, teamIndex, index) {
  if (!p || typeof p !== 'object') throw new Error(`Jogador inválido no time ${teamIndex + 1}.`);
  const steamId = String(p.steamId ?? p.steamID64 ?? p.steamid64 ?? p.steamId64 ?? '').trim();
  if (!steamId) throw new Error(`Jogador ${index + 1} do time ${teamIndex + 1} não possui SteamID.`);
  const nickname = String(p.nickname ?? p.nick ?? p.name ?? '').trim();
  if (!nickname) throw new Error(`O jogador ${steamId} não possui nickname.`);
  const sourceStats = p.stats && typeof p.stats === 'object' ? p.stats : {};
  const stats = {};
  for (const key of STAT_KEYS) {
    if (sourceStats[key] !== undefined && sourceStats[key] !== null && sourceStats[key] !== '') {
      const n = Number(sourceStats[key]);
      if (Number.isFinite(n)) stats[key] = n;
    }
  }
  return { steamId, steamId3: p.steamId3 ? String(p.steamId3) : null, nickname, stats };
}

function normalizeScore(score) {
  if (!score) return null;
  if (Array.isArray(score)) return { team1: Number(score[0]) || 0, team2: Number(score[1]) || 0 };
  if (typeof score === 'object') {
    const team1 = Number(score.team1 ?? score[1] ?? score.a);
    const team2 = Number(score.team2 ?? score[2] ?? score.b);
    if (Number.isFinite(team1) && Number.isFinite(team2)) return { team1, team2 };
  }
  return null;
}

export function calculateRating(stats = {}) {
  const official = Number(stats.rating);
  if (Number.isFinite(official) && official > 0) return official;
  const kills = Number(stats.kills) || 0;
  const deaths = Number(stats.deaths) || 0;
  const assists = Number(stats.assists) || 0;
  const rounds = Number(stats.rounds) || 0;
  const damage = Number(stats.damage) || 0;
  const score = Number(stats.score) || 0;
  const mvps = Number(stats.mvps) || 0;
  const hs = Number(stats.headshots) || 0;
  const entries = Number(stats.entryKills) || 0;
  const clutches = Number(stats.clutches) || 0;
  const multi = Number(stats.multikills) || 0;
  const adr = Number(stats.adr) || (rounds ? damage / rounds : 0);
  const kd = deaths ? kills / deaths : kills;
  const kpr = rounds ? kills / rounds : 0;
  const apr = rounds ? assists / rounds : 0;
  const hsr = kills ? hs / kills : 0;
  // Rating aproximado e determinístico para arquivos sem Rating oficial.
  // Mantém 1.00 como centro e usa apenas estatísticas realmente disponíveis.
  let rating = 0.35 + kd * 0.20 + kpr * 0.90 + apr * 0.25 + (adr / 100) * 0.25 + hsr * 0.10;
  rating += Math.min(0.10, mvps / Math.max(1, rounds) * 0.30);
  rating += Math.min(0.08, entries / Math.max(1, rounds) * 0.35);
  rating += Math.min(0.06, clutches / Math.max(1, rounds) * 0.35);
  rating += Math.min(0.06, multi / Math.max(1, rounds) * 0.20);
  if (score) rating += Math.min(0.10, score / Math.max(1, rounds) * 0.04);
  return Math.max(0, Math.min(3, Number(rating.toFixed(2))));
}

export function calculateDerivedStats(stats = {}) {
  const kills = Number(stats.kills) || 0;
  const deaths = Number(stats.deaths) || 0;
  const assists = Number(stats.assists) || 0;
  const headshots = Number(stats.headshots) || 0;
  const rounds = Number(stats.rounds) || 0;
  const damage = Number(stats.damage) || 0;
  const kd = deaths ? kills / deaths : kills;
  const kda = deaths ? (kills + assists) / deaths : kills + assists;
  const hsPercent = kills ? (headshots / kills) * 100 : 0;
  const adr = stats.adr !== undefined && Number(stats.adr) > 0 ? Number(stats.adr) : (rounds ? damage / rounds : 0);
  const official = Number(stats.rating);
  const hasData = [kills,deaths,assists,headshots,rounds,damage,Number(stats.score)||0,Number(stats.mvps)||0,Number(stats.entryKills)||0,Number(stats.clutches)||0,Number(stats.multikills)||0].some(v => v > 0);
  const rating = Number.isFinite(official) && official > 0 ? official : (hasData ? calculateRating({ ...stats, adr }) : 0);
  const out = { kd, kda, hsPercent, adr };
  if (hasData || (Number.isFinite(official) && official > 0)) { out.rating = rating; out.ratingSource = Number.isFinite(official) && official > 0 ? 'official' : 'calculated'; }
  return out;
}

export async function parseMatchZip(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Selecione um arquivo ZIP.');
  const entries = await readZipEntries(file);
  const jsonEntries = entries.filter(e => /(?:^|\/)matchzy_.*\.json$/i.test(e.name));
  if (!jsonEntries.length) throw new Error('O ZIP não contém arquivos matchzy_*.json.');

  const rounds = [];
  for (const entry of jsonEntries) {
    const text = await entry.text();
    const data = decodeJsonRound(text);
    rounds.push(parseMatchzyRound(data));
  }

  const groups = new Map();
  for (const round of rounds) {
    if (!groups.has(round.matchId)) groups.set(round.matchId, []);
    groups.get(round.matchId).push(round);
  }
  // Um ZIP pode conter mais de uma partida/pasta. Escolhemos a partida com
  // maior quantidade de rounds e, em empate, a mais recente.
  const candidates = [...groups.values()].sort((a,b) => {
    if (b.length !== a.length) return b.length - a.length;
    return String(b[b.length-1].timestamp).localeCompare(String(a[a.length-1].timestamp));
  });
  const result = aggregateRounds(candidates[0]);
  result.source.zipFiles = jsonEntries.map(e => e.name);
  result.source.matchGroups = [...groups.entries()].map(([id, rs]) => ({ matchId:id, rounds:rs.length }));
  return validateNormalizedMatch(result);
}

async function readZipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = p => view.getUint16(p, true);
  const u32 = p => view.getUint32(p, true);

  // EOCD: assinatura 0x06054b50. Procurar do fim para suportar comentários ZIP.
  let eocd = -1;
  const min = Math.max(0, bytes.length - 0xFFFF - 22);
  for (let p = bytes.length - 22; p >= min; p--) {
    if (u32(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('Arquivo não é um ZIP válido ou está corrompido.');

  const count = u16(eocd + 10);
  const centralSize = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  if (centralOffset + centralSize > bytes.length) throw new Error('Estrutura central do ZIP inválida.');

  const entries = [];
  let p = centralOffset;
  for (let i=0; i<count; i++) {
    if (u32(p) !== 0x02014b50) throw new Error('Entrada ZIP inválida.');
    const method = u16(p + 10);
    const compressedSize = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOffset = u32(p + 42);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > bytes.length || u32(localOffset) !== 0x04034b50) {
      throw new Error(`Cabeçalho local inválido: ${name}`);
    }
    const localNameLen = u16(localOffset + 26);
    const localExtraLen = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      async text() {
        let out;
        if (method === 0) out = compressed;
        else if (method === 8) {
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('Seu navegador não suporta descompressão ZIP nativa. Use Chrome/Edge atualizado.');
          }
          const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          out = new Uint8Array(await new Response(stream).arrayBuffer());
        } else {
          throw new Error(`Método de compressão ZIP ${method} não suportado.`);
        }
        return new TextDecoder('utf-8').decode(out);
      }
    });
  }
  return entries;
}

export const supportedStatKeys = STAT_KEYS;
