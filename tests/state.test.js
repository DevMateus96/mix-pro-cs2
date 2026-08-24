import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, newMatch, startDraft, draftPick, confirmTeams, doPickBan, normalizePlayerElo, newPlayerDefaults, calculateEloDelta, levelFromElo, rebuildPlayerStats } from '../src/state.js';
const players=Array.from({length:10},(_,i)=>({id:`p${i}`,name:`P${i}`,available:true,level:1,points:0}));
const maps=Array.from({length:7},(_,i)=>({id:`m${i}`,name:`MAP ${i+1}`}));
function setup(){const s=initialState();s.players=players;s.maps=maps;s.pickBanConfig=[{team:1,type:'BAN'},{team:2,type:'BAN'},{team:1,type:'PICK'},{team:2,type:'PICK'},{team:1,type:'BAN'},{team:2,type:'BAN'},{team:1,type:'PICK'}];s.match=newMatch();s.match.selectedPlayerIds=players.map(p=>p.id);s.match.captainIds=['p0','p1'];s.match.firstCaptainId='p0';return s}
test('Draft rejects fewer than 10',()=>{const s=setup();s.match.selectedPlayerIds=s.match.selectedPlayerIds.slice(0,9);assert.throws(()=>startDraft(s))});
test('Draft follows 1-2-2-2-1',()=>{let s=startDraft(setup());for(const id of ['p2','p3','p4','p5','p6','p7','p8','p9'])s=draftPick(s,id);assert.equal(s.match.teams.a.length,4);assert.equal(s.match.teams.b.length,4);assert.equal(s.match.status,'teams_confirmed')});
test('Cannot pick same player twice',()=>{let s=startDraft(setup());s=draftPick(s,'p2');assert.throws(()=>draftPick(s,'p2'))});
test('Confirm teams then Pick & Ban locks used maps',()=>{let s=startDraft(setup());for(const id of ['p2','p3','p4','p5','p6','p7','p8','p9'])s=draftPick(s,id);s=confirmTeams(s);s=doPickBan(s,'m0','p0');assert.throws(()=>doPickBan(s,'m0','p1'));assert.equal(s.match.pickBan.remainingMapIds.includes('m0'),false)});
test('Winner of draw starts and sequence alternates 1-2-2-2-1',()=>{
  let s=setup();
  s.match.firstCaptainId='p1';
  s=startDraft(s);
  assert.equal(s.match.draft.currentCaptainId,'p1');
  // Winner p1 picks 1
  s=draftPick(s,'p2');
  assert.equal(s.match.draft.currentCaptainId,'p0');
  // Other p0 picks 2
  s=draftPick(s,'p3');
  s=draftPick(s,'p4');
  assert.equal(s.match.draft.currentCaptainId,'p1');
  // Winner p1 picks 2
  s=draftPick(s,'p5');
  s=draftPick(s,'p6');
  assert.equal(s.match.draft.currentCaptainId,'p0');
  // Other p0 picks 2
  s=draftPick(s,'p7');
  s=draftPick(s,'p8');
  assert.equal(s.match.draft.currentCaptainId,'p1');
  // Winner p1 picks last
  s=draftPick(s,'p9');
  assert.equal(s.match.status,'teams_confirmed');
  assert.deepEqual(s.match.teams.a,['p3','p4','p7','p8']);
  assert.deepEqual(s.match.teams.b,['p2','p5','p6','p9']);
});

test('Novos jogadores usam Level 5 e Elo inicial 500',()=>{ assert.deepEqual(newPlayerDefaults(),{level:5,points:500}); });
test('Elo nunca fica negativo no limite Level 0',()=>{ const p={level:0,points:-30}; normalizePlayerElo(p); assert.equal(p.level,0); assert.equal(p.points,0); });
test('Elo negativo é limitado a zero e o Level é sempre derivado do Elo',()=>{ const p={level:5,points:-10}; normalizePlayerElo(p); assert.equal(p.points,0); assert.equal(p.level,0); const q={level:7,points:735}; normalizePlayerElo(q); assert.equal(q.points,735); assert.equal(q.level,7); const r={level:99,points:1000}; normalizePlayerElo(r); assert.equal(r.level,10); });
test('Faixas de Level são definidas automaticamente pelo Elo',()=>{ assert.equal(levelFromElo(0),0); assert.equal(levelFromElo(99),0); assert.equal(levelFromElo(100),1); assert.equal(levelFromElo(499),4); assert.equal(levelFromElo(500),5); assert.equal(levelFromElo(599),5); assert.equal(levelFromElo(600),6); assert.equal(levelFromElo(1000),10); assert.equal(levelFromElo(1200),12); });
test('Regras de Elo por KDA para vitória e derrota',()=>{ assert.equal(calculateEloDelta(0.7,true),19); assert.equal(calculateEloDelta(0.8,true),20); assert.equal(calculateEloDelta(1.1,true),21); assert.equal(calculateEloDelta(1.3,true),22); assert.equal(calculateEloDelta(0.7,false),-22); assert.equal(calculateEloDelta(0.8,false),-20); assert.equal(calculateEloDelta(1.1,false),-19); assert.equal(calculateEloDelta(1.4,false),-18); });
test('Rebuild aplica Elo acumulativo e registra histórico individual',()=>{ const s=initialState(); s.players=[{id:'p1',name:'A',stats:{}},{id:'p2',name:'B',stats:{}}]; s.matches=[{id:'m1',createdAt:'2026-08-20T00:00:00Z',winnerTeam:1,players:[{playerId:'p1',team:1,stats:{kills:13,deaths:10,assists:0}},{playerId:'p2',team:2,stats:{kills:7,deaths:10,assists:0}}]},{id:'m2',createdAt:'2026-08-21T00:00:00Z',winnerTeam:1,players:[{playerId:'p1',team:1,stats:{kills:20,deaths:10,assists:0}},{playerId:'p2',team:2,stats:{kills:10,deaths:20,assists:0}}]}]; rebuildPlayerStats(s); assert.equal(s.players[0].points,544); assert.equal(s.players[0].level,5); assert.equal(s.players[1].points,456); assert.equal(s.players[1].level,4); assert.equal(s.matches[0].players[0].eloBefore,500); assert.equal(s.matches[0].players[0].eloAfter,522); assert.equal(s.matches[1].players[0].eloBefore,522); assert.equal(s.matches[1].players[0].eloAfter,544); });
