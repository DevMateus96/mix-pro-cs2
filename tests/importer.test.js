import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchImport, parseMatchzyRound, parseMatchCsv, calculateDerivedStats } from '../src/matchImporter.js';
import { initialState, isDuplicateMatch, rebuildPlayerStats } from '../src/state.js';

const raw = JSON.stringify({
  match: {
    id: 'srv-1',
    map: 'Mirage',
    score: {team1:13, team2:9},
    winnerTeam: 1,
    rounds: 22,
    teams: [
      {id:1,name:'A',players:[{steamId:'s1',nickname:'NickA',stats:{kills:24,deaths:12,assists:8,headshots:12,damage:2000,rounds:22}}]},
      {id:2,name:'B',players:[{steamId:'s2',nickname:'NickB',stats:{kills:12,deaths:24,assists:3,headshots:6,damage:1300,rounds:22}}]}
    ]
  }
});
test('Importador aceita apenas o contrato normalizado e preserva os dados',()=>{
  const m=parseMatchImport(raw);
  assert.equal(m.map,'Mirage');
  assert.equal(m.players[0].steamId,'s1');
  assert.equal(m.players[0].stats.kills,24);
  assert.equal(m.winnerTeam,1);
});

test('Estatísticas derivadas evitam divisão por zero',()=>{
  const d=calculateDerivedStats({kills:0,deaths:0,assists:2,headshots:0});
  assert.equal(d.kd,0); assert.equal(d.kda,2); assert.equal(d.hsPercent,0); assert.equal(d.adr,0); assert.ok(d.rating>0);
});

test('Fingerprint impede duplicação lógica',()=>{
  const m=parseMatchImport(raw);
  const s=initialState();
  s.matches=[{...m,players:m.players}];
  const candidate={...m,players:m.players};
  assert.equal(isDuplicateMatch(s,candidate),true);
});

test('Rebuild calcula agregados sem depender de contadores manuais',()=>{
  const s=initialState();
  s.players=[{id:'p1',name:'A',stats:{}},{id:'p2',name:'B',stats:{}}];
  s.matches=[{id:'m',createdAt:'2026-08-20T00:00:00Z',winnerTeam:1,rounds:22,players:[
    {playerId:'p1',team:1,stats:{kills:24,deaths:12,assists:8,headshots:12,damage:2000,mvps:1}},
    {playerId:'p2',team:2,stats:{kills:12,deaths:24,assists:3,headshots:6,damage:1300}}
  ]}];
  rebuildPlayerStats(s);
  assert.equal(s.players[0].stats.matches,1);
  assert.equal(s.players[0].stats.wins,1);
  assert.equal(s.players[0].stats.kills,24);
  assert.equal(Math.round(s.players[0].stats.kd*100)/100,2);
});

test('MatchZy round real: extrai jogadores, SteamID64, placar e estatísticas',()=>{
  const valveBackup = `"SaveFile" {
    "PlayersOnTeam1" {
      "1563210829" {
        "name" "iAgAO"
        "kills" "18"
        "assists" "1"
        "deaths" "15"
        "mvps" "1"
        "MatchStats" {
          "Totals" {
            "Kills" "18"
            "Damage" "1608"
            "Deaths" "15"
            "Assists" "1"
            "HeadshotKills" "7"
            "UtilityDamage" "11"
            "1v2Wins" "0"
            "EntryWins" "3"
          }
        }
      }
    }
    "PlayersOnTeam2" {
      "368855533" {
        "name" "ozhyyyy"
        "kills" "27"
        "assists" "8"
        "deaths" "12"
        "mvps" "5"
        "MatchStats" {
          "Totals" {
            "Kills" "27"
            "Damage" "3176"
            "Deaths" "12"
            "Assists" "8"
            "HeadshotKills" "18"
            "UtilityDamage" "180"
            "1v2Wins" "0"
            "EntryWins" "6"
          }
        }
      }
    }
  }`;
  const m=parseMatchzyRound({
    matchid:"5", timestamp:"2026-08-19 02:49:27", map_name:"de_dust2",
    team1_name:"team_iAgAO_", team2_name:"team_PJFraga-",
    team1_side:"TERRORIST", team2_side:"CT",
    team1_score:"12", team2_score:"9", round:"21", valve_backup:valveBackup
  });
  assert.equal(m.map,'dust2');
  assert.equal(m.score.team1,12);
  assert.equal(m.score.team2,9);
  assert.equal(m.teams[0].players[0].steamId,'76561199523476557');
  assert.equal(m.teams[1].players[0].stats.damage,3176);
});


test('CSV real separa times e preserva SteamID',()=>{
  const csv='steamid64,team,name,kills,deaths,assists,head_shot_kills,damage\n76561197960265729,team_A,A,24,12,8,12,1800\n76561197960265730,team_B,B,10,20,4,5,900';
  const m=parseMatchCsv(csv);
  assert.equal(m.teams.length,2); assert.equal(m.teams[0].players.length,1); assert.equal(m.teams[1].players.length,1);
  assert.equal(m.players[0].steamId,'76561197960265729'); assert.equal(m.players[0].stats.kills,24);
});
