import { initialState, loadState, saveState, newMatch, statusLabels, playerById, findPlayerBySteamId, draftRounds, startDraft, draftPick, confirmTeams, doPickBan, DEFAULT_MAPS, DEFAULT_PICK_BAN_CONFIG, rebuildPlayerStats, isDuplicateMatch, matchFingerprint, normalizePlayerElo, newPlayerDefaults } from './state.js';
import { parseMatchImport, parseMatchZip, parseMatchCsv, calculateDerivedStats, supportedStatKeys } from './matchImporter.js';

// Utilitários precisam existir antes da migração do estado, pois instalações antigas
// podem ter `maps: []` e exigir a recriação do pool padrão durante o carregamento.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

let state = initialState();
let stateVersion = null;
let saveTimer = null;
let saveInFlight = false;
let currentView = 'dashboard';
let draftDrawBusy = false;
let selectedProfileId = null;
let processedImport = null;
let importUnknownPlayers = [];

// Migração leve: instalações anteriores que não tinham mapas/sequência recebem os padrões definidos para esta plataforma.
if (!state.maps?.length) state.maps = DEFAULT_MAPS.map(name => ({ id: uid(), name, image: '' }));
if (!state.pickBanConfig?.length) state.pickBanConfig = structuredClone(DEFAULT_PICK_BAN_CONFIG);
function persist() {
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncState, 250);
}
async function syncState(){
  if(saveInFlight) return;
  saveInFlight=true;
  try{const saved=await saveState(state,stateVersion); stateVersion=saved.version;}
  catch(e){toast(e.message||'Falha ao salvar no banco de dados.',true);}
  finally{saveInFlight=false;}
}
async function bootstrap(){
  try{const loaded=await loadState(); state=loaded.state; stateVersion=loaded.version;}
  catch(e){toast('Não foi possível conectar ao banco de dados. Verifique a API.',true);}
  render();
}
function ensureMatch() { if (!state.match) { state.match = newMatch(); persist(); } }
function toast(msg, error=false) { const el = $('#toast'); el.textContent = msg; el.className = `toast show ${error?'error':''}`; setTimeout(()=>el.classList.remove('show'),2600); }
function nav(view) { currentView = view; render(); }
function playerName(id) { return playerById(state,id)?.name || 'Jogador removido'; }
function getPlayerAvatar(playerId){ const p=playerById(state,playerId); return p?.avatar ? esc(p.avatar) : ''; }
function avatarHtml(playerId, size=''){ const p=playerById(state,playerId); const name=p?.name || 'Jogador'; const src=getPlayerAvatar(playerId); return `<span class="avatar ${size}">${src?`<img src="${src}" alt="${esc(name)}" loading="lazy">`:esc(name.slice(0,2).toUpperCase())}</span>`; }
function teamName(slot) { const id = state.match?.captainIds?.[slot]; return id ? playerName(id) : `Time ${slot+1}`; }

function render() {
  document.body.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">M</span><div><b>MIX PRO</b><small>CS2 Match Manager</small></div></div>
      <nav>
        ${[['dashboard','Visão geral','⌂'],['players','Jogadores','♙'],['history','Histórico','▣'],['admin','Administração','⚙']].map(([v,l,i])=>`<button class="nav-item ${currentView===v?'active':''}" data-nav="${v}"><span>${i}</span>${l}</button>`).join('')}
      </nav>
      <div class="sidebar-foot">v2.0 · histórico persistente<br>Importador MatchZy ZIP + JSON</div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="eyebrow">COUNTER-STRIKE 2</div><h1>${pageTitle()}</h1></div><div class="top-actions">${state.match?`<span class="status-pill">${statusLabels[state.match.status]}</span>`:''}<button class="btn ghost" id="new-match">Nova partida</button></div></header>
      <section class="content">${viewHtml()}</section>
    </main>
    <div id="toast" class="toast"></div>
  </div>`;
  bind();
}
function pageTitle(){ if(currentView==='players') return 'Jogadores'; if(currentView==='history') return 'Histórico de partidas'; if(currentView==='profile') return 'Perfil do jogador'; if(currentView==='admin') return 'Administração'; if(currentView==='match') return statusLabels[state.match?.status] || 'Partida'; return 'Central de partidas'; }
function viewHtml(){
  if(currentView==='players') return playersView();
  if(currentView==='history') return historyView();
  if(currentView==='profile') return profileView();
  if(currentView==='admin') return adminView();
  if(currentView==='match') return matchView();
  return dashboardView();
}
function dashboardView(){
  const m=state.match;
  const top5=[...state.players]
    .sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||String(a.nickname||a.name||'').localeCompare(String(b.nickname||b.name||'')))
    .slice(0,5);
  const medal=['🥇','🥈','🥉'];
  return `<div class="hero-grid dashboard-top">
    <div class="hero-card"><div class="hero-kicker">MIX CONTROL</div><h2>Organize seu próximo 5v5.</h2><p>Selecione 10 jogadores, defina os capitães, execute o Draft e finalize o Pick & Ban com histórico completo.</p><button class="btn primary" id="start-match">${m?'Continuar partida':'Iniciar nova partida'}</button></div>
    <section class="top5-panel" aria-label="Top 5 — Maior Rating">
      <div class="top5-head"><div><div class="eyebrow">RANKING DE DESTAQUE</div><h3>🏆 TOP 5 — MAIOR RATING</h3><p>Ordenado automaticamente pelo Elo atual.</p></div><span class="top5-badge">ELO</span></div>
      ${top5.length?`<div class="top5-list">${top5.map((p,i)=>`<button class="top5-row top5-rank-${i+1}" data-profile-player="${p.id}" aria-label="${i+1}º lugar, ${esc(p.nickname||p.name)}, ${Number(p.points)||0} Elo">
        <span class="top5-position">${medal[i]||`<b>${i+1}</b>`}</span>
        ${avatarHtml(p.id,'top5-avatar')}
        <span class="top5-player"><b>${esc(p.nickname||p.name)}</b><small>${esc(p.name||'')}</small></span>
        <span class="top5-level">LVL ${p.level??0}</span>
        <strong class="top5-elo">${Number(p.points)||0}</strong>
      </button>`).join('')}</div>`:`<div class="top5-empty"><span>🏆</span><b>Nenhum jogador cadastrado</b><small>Cadastre jogadores para formar o Top 5.</small></div>`}
    </section>
  </div>
  <div class="section-head"><div><div class="eyebrow">RANKING</div><h3>Ranking por Elo</h3><p class="muted">Ordenado automaticamente pelo Elo atual.</p></div></div>
  ${state.players.length?`<div class="ranking-panel">${[...state.players].sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||String(a.name||'').localeCompare(String(b.name||''))).map((p,i)=>`<button class="ranking-row" data-profile-player="${p.id}"><span class="ranking-position">#${i+1}</span>${avatarHtml(p.id)}<span class="ranking-player"><b>${esc(p.nickname||p.name)}</b><small>${esc(p.name)}</small></span><span class="ranking-level">LVL ${p.level??0}</span><strong>${Number(p.points)||0} Elo</strong></button>`).join('')}</div>`:`<div class="empty"><p>Nenhum jogador cadastrado.</p></div>`}
  <div class="section-head"><div><div class="eyebrow">FLUXO</div><h3>Etapas da partida</h3></div></div>
  <div class="stepper">${Object.entries(statusLabels).map(([k,l],i)=>`<div class="step ${m&&m.status===k?'current':''} ${m&&Object.keys(statusLabels).indexOf(m.status)>i?'done':''}"><span>${i+1}</span><b>${l}</b></div>`).join('')}</div>
  ${m?`<div class="panel compact"><div><b>Partida atual</b><p>${new Date(m.createdAt).toLocaleString('pt-BR')}</p></div><button class="btn primary" id="open-match">Abrir partida</button></div>`:''}`;
}
function playersView(){
  return `<div class="section-head"><div><div class="eyebrow">ROSTER</div><h3>${state.players.length} jogadores cadastrados</h3></div><button class="btn primary" id="select-players">Selecionar jogadores para partida</button></div>
  ${state.match?.status==='selection'?`<div class="selection-banner"><b>${state.match.selectedPlayerIds.length}/10 selecionados</b><span>Escolha exatamente 10 jogadores para avançar.</span><button class="btn small" id="go-captains">Continuar</button></div>`:''}
  <div class="player-grid">${state.players.length?state.players.map(p=>`<article class="player-card ${state.match?.selectedPlayerIds.includes(p.id)?'selected':''} ${!p.available?'disabled':''}" data-profile-player="${p.id}">${avatarHtml(p.id)}<div class="player-main"><div class="player-name">${esc(p.name)}</div><div class="player-meta"><span class="level">LVL ${p.level??0}</span><span>${p.points??0} Elo</span><span class="dot-status ${p.available?'on':'off'}">${p.available?'Disponível':'Indisponível'}</span></div></div>${state.match?.status==='selection'?`<button class="select-toggle" data-player="${p.id}" ${!p.available?'disabled':''}>${state.match.selectedPlayerIds.includes(p.id)?'✓':'+'}</button>`:''}</article>`).join(''):`<div class="empty"><div class="empty-icon">♙</div><h3>Nenhum jogador cadastrado</h3><p>Cadastre os jogadores na Administração para começar.</p><button class="btn primary" data-nav="admin">Cadastrar jogador</button></div>`}</div>`;
}
function adminView(){
  return `<div class="admin-grid">
    <div class="panel"><div class="section-head"><div><div class="eyebrow">CADASTRO</div><h3>Jogadores</h3></div></div><form id="player-form" class="form-grid"><input name="name" placeholder="Nome cadastrado" required><input name="nickname" placeholder="Nick atual (opcional)"><input name="steamId" placeholder="SteamID64 (opcional)"><input name="level" type="number" min="0" max="99" value="5" readonly title="Novos jogadores iniciam no Level 5" placeholder="Level"><input name="points" type="number" min="0" value="500" readonly title="Novos jogadores iniciam com 500 Elo" placeholder="Elo"><input name="avatar" placeholder="URL do avatar (opcional)"><button class="btn primary" type="submit">Adicionar jogador</button></form><div class="admin-list">${state.players.map(p=>`<div class="admin-row"><div class="admin-player">${avatarHtml(p.id)}<div><b>${esc(p.name)}</b><small>${p.steamId?`SteamID ${esc(p.steamId)}`:'Sem SteamID'} · LVL ${p.level??0} · ${p.points??0} Elo · ${p.available?'Disponível':'Indisponível'}</small></div></div><div class="row-actions"><button class="btn small" data-edit-player="${p.id}">Editar</button><button class="btn small" data-toggle-player="${p.id}">${p.available?'Desativar':'Ativar'}</button><button class="btn small danger" data-remove-player="${p.id}">Remover</button></div></div>`).join('')||'<p class="muted">Nenhum jogador.</p>'}</div></div>
    <div class="panel"><div class="section-head"><div><div class="eyebrow">MAP POOL</div><h3>Mapas</h3><p class="muted">Pool padrão já configurado com os 9 mapas fornecidos. Você pode editar/remover quando quiser.</p></div></div><form id="map-form" class="form-grid"><input name="name" placeholder="Nome exato do mapa" required><input name="image" placeholder="URL da imagem (opcional)"><button class="btn primary" type="submit">Adicionar mapa</button></form><div class="admin-list">${state.maps.map(m=>`<div class="admin-row"><div><b>${esc(m.name)}</b><small>${m.image?'Imagem configurada':'Sem imagem'}</small></div><button class="btn small danger" data-remove-map="${m.id}">Remover</button></div>`).join('')||'<p class="muted">Nenhum mapa configurado.</p>'}</div></div>
    <div class="panel full"><div class="section-head"><div><div class="eyebrow">PICK & BAN</div><h3>Sequência configurável</h3><p class="muted">Sequência padrão: T1 BAN → T2 BAN → T1 BAN → T2 BAN → T1 PICK → T2 PICK → T1 BAN → T2 BAN. O 9º mapa restante é o decisivo.</p></div><button class="btn ghost" id="reset-pb-config">Limpar sequência</button></div><div class="pb-config">${state.pickBanConfig.map((s,i)=>`<div class="config-row"><span class="config-num">${i+1}</span><select data-config-team="${i}"><option value="1" ${s.team===1?'selected':''}>Time 1</option><option value="2" ${s.team===2?'selected':''}>Time 2</option></select><select data-config-type="${i}"><option value="BAN" ${s.type==='BAN'?'selected':''}>BAN</option><option value="PICK" ${s.type==='PICK'?'selected':''}>PICK</option></select><button class="icon-btn" data-remove-step="${i}">×</button></div>`).join('')}</div><button class="btn secondary" id="add-pb-step">+ Adicionar etapa</button></div>
    <div class="panel full import-panel"><div class="section-head"><div><div class="eyebrow">MIX PRO · IMPORTADOR</div><h3>Importar partida</h3><p class="muted">Cole os dados reais da partida. O importador preserva o conteúdo bruto e só grava estatísticas que existirem nos dados recebidos.</p></div></div>
      <textarea id="match-import-data" class="import-textarea" placeholder='Opcional: cole um JSON normalizado. Para MatchZy, selecione o .ZIP. Para estatísticas tabulares, selecione o .CSV. O placar pode ser definido manualmente pelo administrador.'></textarea>
      <div class="import-actions"><label class="btn ghost file-btn">Selecionar ZIP/JSON/CSV<input id="match-import-file" type="file" accept=".zip,.json,.csv,.log,.txt" hidden></label><button class="btn primary" id="process-import">Processar partida</button></div>
      <p class="muted import-hint">O ZIP é lido no navegador. Se houver mais de uma partida no arquivo, o MIX PRO seleciona automaticamente o grupo com mais rounds.</p>
      ${processedImport ? importPreview(processedImport) : ''}
    </div>
    <div class="panel full"><div class="section-head"><div><div class="eyebrow">MANUTENÇÃO</div><h3>Partida</h3></div></div><div class="danger-zone"><button class="btn danger" id="cancel-match">Cancelar partida atual</button><button class="btn ghost" id="reset-draft">Reiniciar Draft</button><button class="btn ghost" id="reset-pb">Reiniciar Pick & Ban</button></div></div>
  </div>`;
}
function matchView(){
  ensureMatch(); const m=state.match;
  if(m.status==='selection') return selectionStage();
  if(m.status==='captains') return captainStage();
  if(m.status==='draw') return drawStage();
  if(m.status==='draft') return draftStage();
  if(m.status==='teams_confirmed') return teamsStage();
  if(['pickban','ready','finished'].includes(m.status)) return pickBanStage();
}
function selectionStage(){ return `<div class="stage"><div class="stage-header"><div><div class="eyebrow">ETAPA 1/7</div><h2>Selecione os 10 jogadores</h2><p>Somente jogadores ativos podem participar. O Draft ficará bloqueado até atingir exatamente 10.</p></div><div class="counter">${state.match.selectedPlayerIds.length}<small>/10</small></div></div><div class="player-grid">${state.players.map(p=>`<article class="player-card ${state.match.selectedPlayerIds.includes(p.id)?'selected':''} ${!p.available?'disabled':''}"><div class="avatar">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:esc(p.name.slice(0,2).toUpperCase())}</div><div class="player-main"><div class="player-name">${esc(p.name)}</div><div class="player-meta"><span>LVL ${p.level}</span><span>${p.points} Elo</span></div></div><button class="select-toggle" data-player="${p.id}" ${!p.available?'disabled':''}>${state.match.selectedPlayerIds.includes(p.id)?'✓':'+'}</button></article>`).join('')}</div><div class="stage-footer"><button class="btn primary" id="to-captains" ${state.match.selectedPlayerIds.length!==10?'disabled':''}>Escolher capitães</button></div></div>`; }
function captainStage(){ const ids=state.match.selectedPlayerIds; return `<div class="stage"><div class="stage-header"><div><div class="eyebrow">ETAPA 2/7</div><h2>Defina os capitães</h2><p>Selecione exatamente dois dos dez jogadores.</p></div><div class="counter">${state.match.captainIds.length}<small>/2</small></div></div><div class="captain-grid">${ids.map(id=>`<button class="captain-card ${state.match.captainIds.includes(id)?'chosen':''}" data-captain="${id}">${avatarHtml(id)}<b>${esc(playerName(id))}</b><span>${state.match.captainIds.includes(id)?'CAPITÃO':''}</span></button>`).join('')}</div><div class="stage-footer"><button class="btn primary" id="to-draw" ${state.match.captainIds.length!==2?'disabled':''}>Sortear quem começa</button></div></div>`; }
function drawStage(){ const c=state.match.captainIds; return `<div class="draw-screen"><div class="eyebrow">ETAPA 3/7 · SORTEIO</div><h2>Quem começa o Draft?</h2><div class="draw-cards ${draftDrawBusy?'shuffling':''}">${c.map(id=>`<div class="draw-card">${avatarHtml(id,'xl')}<b>${esc(playerName(id))}</b></div>`).join('<div class="vs">VS</div>')}</div>${state.match.firstCaptainId&&!draftDrawBusy?`<div class="draw-result">🏆 <b>${esc(playerName(state.match.firstCaptainId))} COMEÇA O DRAFT</b></div>`:''}<button class="btn primary huge" id="run-draw" ${draftDrawBusy||state.match.firstCaptainId?'disabled':''}>${draftDrawBusy?'Sorteando…':state.match.firstCaptainId?'Sorteio concluído':'Sortear quem começa'}</button></div>`; }
function draftStage(){ const m=state.match; const round=draftRounds[m.draft.round]; const current=m.draft.currentCaptainId; return `<div class="draft-stage"><div class="draft-top"><div><div class="eyebrow">ETAPA 4/7 · DRAFT</div><h2>Montagem dos times</h2></div><div class="round-pill">Rodada ${m.draft.round+1}/5 · ${m.draft.pickCount} escolha${m.draft.pickCount>1?'s':''}</div></div><div class="teams"><div class="team-panel ${m.captainIds[0]===current?'active':''}"><div class="team-title">TIME 1 <span>${m.captainIds[0]===current?'ESCOLHENDO':''}</span></div>${teamMembers(m,'a',0)}</div><div class="turn-center"><div class="turn-label">VEZ DE</div><strong>${esc(playerName(current))}</strong><div class="turn-action">Escolha ${m.draft.pickCount} jogador${m.draft.pickCount>1?'es':''}</div><div class="progress-dots">${draftRounds.map((_,i)=>`<span class="${i<=m.draft.round?'on':''}"></span>`).join('')}</div></div><div class="team-panel ${m.captainIds[1]===current?'active':''}"><div class="team-title">TIME 2 <span>${m.captainIds[1]===current?'ESCOLHENDO':''}</span></div>${teamMembers(m,'b',1)}</div></div><div class="available-wrap"><div class="section-head"><div><div class="eyebrow">DISPONÍVEIS</div><h3>Clique em qualquer jogador disponível</h3></div></div><div class="available-grid">${m.draft.available.map(id=>`<button class="available-player" data-draft-pick="${id}">${avatarHtml(id)}<span>${esc(playerName(id))}</span><small>Vai automaticamente para o time da vez</small></button>`).join('')}</div></div></div>`; }
function teamMembers(m,key,slot){ const cap=m.captainIds[slot]; const arr=m.teams[key]; return `<div class="member captain">${avatarHtml(cap)}<div><b>${esc(playerName(cap))}</b><small>CAPITÃO</small></div></div>${[0,1,2,3].map(i=>`<div class="member ${arr[i]?'filled':''}">${arr[i]?`${avatarHtml(arr[i])}<div><b>${esc(playerName(arr[i]))}</b><small>JOGADOR</small></div>`:`<span class="slot-num">${i+1}</span><div><b>Disponível</b><small>Aguardando pick</small></div>`}</div>`).join('')}`; }
function teamsStage(){ const m=state.match; return `<div class="stage"><div class="stage-header"><div><div class="eyebrow">ETAPA 5/7</div><h2>Times definidos</h2><p>Confira a composição antes de liberar o Pick & Ban.</p></div></div><div class="teams"><div class="team-panel"> <div class="team-title">TIME 1</div>${teamMembers(m,'a',0)}</div><div class="turn-center"><div class="check-mark">✓</div><strong>Draft concluído</strong><div class="turn-action">10 jogadores distribuídos</div></div><div class="team-panel"><div class="team-title">TIME 2</div>${teamMembers(m,'b',1)}</div></div><div class="stage-footer"><button class="btn primary" id="confirm-teams">Confirmar Times</button></div></div>`; }
function pickBanStage(){ const m=state.match; const active=state.pickBanConfig[m.pickBan.index]; const actionLabel=active?`${active.type==='BAN'?'Banir':'Escolher'} um mapa`:(m.status==='ready'?'Partida pronta':'Configure o Pick & Ban na Administração'); return `<div class="pb-stage"><div class="pb-header"><div><div class="eyebrow">ETAPA ${m.status==='ready'?'7':'6'}/7</div><h2>PICK & BAN</h2><p>${m.status==='ready'?'Sequência concluída. O mapa está definido.':active?`VEZ DO TIME ${active.team} · ${actionLabel}`:'Nenhuma sequência configurada.'}</p></div><div class="team-badges"><span>TIME 1 · ${esc(teamName(0))}</span><span>TIME 2 · ${esc(teamName(1))}</span></div></div><div class="pb-layout"><div class="maps-grid">${state.maps.length?state.maps.map(mapCard).join(''):`<div class="empty"><div class="empty-icon">◈</div><h3>Nenhum mapa configurado</h3><p>Adicione os mapas e a sequência na Administração.</p><button class="btn primary" data-nav="admin">Abrir Administração</button></div>`}</div><aside class="history"><div class="eyebrow">HISTÓRICO</div><h3>Ações da partida</h3>${m.history.length?m.history.map(h=>`<div class="history-row"><span class="history-type ${h.type.toLowerCase()}">${h.type}</span><div><b>${h.team?`TIME ${h.team}`:'DRAFT'}</b><span>${esc(h.mapName||playerName(h.playerId))}</span></div><small>${new Date(h.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small></div>`).join(''):'<p class="muted">Nenhuma ação registrada.</p>'}</aside></div>${m.status==='ready'||m.status==='finished'?finalMatchSummary(m):''}${m.status==='ready'?finishMatchPanel(m):''}</div>`; }
function finishMatchPanel(m){
  const decisiveId=m.pickBan?.remainingMapIds?.[0];
  const autoMap=state.maps.find(x=>x.id===decisiveId)?.name || m.map || '';
  return `<div class="panel finish-panel"><div class="eyebrow">FINALIZAÇÃO DA PARTIDA</div><h3>Informe o resultado real</h3><p class="muted">O mapa é obrigatório. Se o Pick & Ban já definiu um mapa decisivo, ele será preenchido automaticamente, mas pode ser corrigido pelo administrador.</p><div class="finish-grid"><label>MAPA JOGADO<select id="finish-map"><option value="">Selecione o mapa</option>${state.maps.map(x=>`<option value="${esc(x.name)}" ${String(x.name).toLowerCase()===String(autoMap).toLowerCase()?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>TIME 1 · ${esc(teamName(0))}<input id="finish-score-1" type="number" min="0" value="${m.score?.team1??''}" placeholder="0"></label><label>TIME 2 · ${esc(teamName(1))}<input id="finish-score-2" type="number" min="0" value="${m.score?.team2??''}" placeholder="0"></label></div><button class="btn primary" id="finish-match">Salvar partida finalizada</button></div>`;
}

function finalMatchSummary(m){
  const picks = m.pickBan.actions.filter(a=>a.type==='PICK');
  const decisiveId = m.pickBan.remainingMapIds[0];
  const decisive = state.maps.find(x=>x.id===decisiveId);
  return `<div class="match-summary"><div class="summary-title"><div class="eyebrow">RESULTADO DO PICK & BAN</div><h3>Times e mapas definidos</h3><p>Confira quem escolheu cada mapa e qual mapa ficou como decisivo.</p></div><div class="summary-grid"><div class="summary-team"><span>TIME 1 · ${esc(teamName(0))}</span>${m.teams.a.map(id=>`<b>${esc(playerName(id))}</b>`).join('')}</div><div class="summary-team"><span>TIME 2 · ${esc(teamName(1))}</span>${m.teams.b.map(id=>`<b>${esc(playerName(id))}</b>`).join('')}</div></div><div class="map-results"><div class="map-result-card"><div class="eyebrow">MAPAS ESCOLHIDOS</div>${picks.length?picks.map(a=>`<div class="result-row"><strong>${esc(a.mapName)}</strong><span>TIME ${a.team} · PICK por ${esc(playerName(a.actorId))}</span></div>`).join(''):'<p class="muted">Nenhum mapa foi escolhido.</p>'}</div><div class="map-result-card decisive"><div class="eyebrow">MAPA DECISIVO</div><strong>${decisive?esc(decisive.name):'—'}</strong><span>Mapa restante após a sequência de Pick & Ban</span></div></div></div>`;
}
function mapCard(map){ const m=state.match; const used=m.pickBan.actions.find(a=>a.mapId===map.id); const available=m.pickBan.remainingMapIds.includes(map.id); const active=state.pickBanConfig[m.pickBan.index]; return `<article class="map-card ${used?'used':''} ${used?.type?.toLowerCase()||''}">${map.image?`<img src="${esc(map.image)}" alt="">`:`<div class="map-placeholder">MAP</div>`}<div class="map-info"><b>${esc(map.name)}</b><span>${used?used.type:available&&active?`Disponível · Time ${active.team}`:'Bloqueado'}</span></div>${used?`<div class="map-result">${used.type}</div>`:active&&available?`<div class="map-actions"><button class="btn small ${active.type==='PICK'?'primary':'danger'}" data-map-action="${map.id}">${active.type}</button></div>`:`<div class="map-lock">—</div>`}</article>`; }


function fmt(n, digits=2){ return Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '0'; }
function formatDate(iso){ try{return new Date(iso).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return '—'} }
function statsLine(s){
  const d=calculateDerivedStats(s||{});
  return `${s?.kills??0}/${s?.deaths??0}/${s?.assists??0} · K/D ${fmt(d.kd)} · ADR ${fmt(s?.adr??d.adr,1)} · HS ${fmt(d.hsPercent,1)}%`;
}
function historyView(){
  const matches=[...(state.matches||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const rows=matches.map(m=>`<article class="history-card">
    <div><div class="eyebrow">${esc(m.map||'MAPA NÃO INFORMADO')}</div><h3>${m.score?`${m.score.team1} × ${m.score.team2}`:'Resultado não informado'}</h3><p>${formatDate(m.createdAt)} · ${m.players?.length||0} jogadores · ${m.winnerTeam?`Vencedor: Time ${m.winnerTeam}`:'Vencedor não informado'}</p></div>
    <div class="history-card-actions"><button class="btn small primary" data-view-match="${m.id}">Ver partida</button><button class="btn small danger" data-delete-match="${m.id}">Excluir</button></div>
  </article>`).join('');
  return `<div class="section-head"><div><div class="eyebrow">HISTÓRICO PERMANENTE</div><h3>${matches.length} partida${matches.length===1?'':'s'}</h3><p class="muted">Ordenado da mais recente para a mais antiga. As estatísticas são reconstruídas a partir das partidas salvas.</p></div><button class="btn primary" data-nav="admin">Importar partida</button></div>
  ${matches.length?`<div class="history-list">${rows}</div>`:`<div class="empty"><div class="empty-icon">▣</div><h3>Nenhuma partida importada</h3><p>Depois de uma partida no servidor CS2, use Administração → Importar partida.</p></div>`}`;
}
function statValue(value, suffix=''){
  return value === undefined || value === null || value === '' ? '—' : `${value}${suffix}`;
}
function profileStatCard(label, value, cls=''){
  return `<div class="profile-stat-card ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
}
function profileView(){
  const p=playerById(state,selectedProfileId);
  if(!p) return `<div class="empty"><h3>Jogador não encontrado</h3><button class="btn primary" data-nav="players">Voltar</button></div>`;
  const s=p.stats||{};
  const matches=(state.matches||[]).filter(m=>(m.players||[]).some(x=>x.playerId===p.id)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const recent=matches.slice(0,20);
  const combat=[['Kills',s.kills],['Deaths',s.deaths],['Assists',s.assists],['K/D',fmt(s.kd)],['KDA',fmt(s.kda)],['Damage',s.damage],['ADR',fmt(s.adr,1)]];
  const precision=[['Headshots',s.headshots],['HS%',statValue(fmt(s.hsPercent,1),'%')]];
  const impact=[['Rating',fmt(s.rating)],['MVPs',s.mvps],['Entry Kills',s.entryKills],['Clutches',s.clutches],['Multikills',s.multikills],['Flash Assists',s.flashAssists],['Utility Damage',s.utilityDamage]];
  const rounds=[['Rounds jogados',s.rounds],['Rounds vencidos',s.roundsWon],['Rounds perdidos',s.roundsLost],['Win Rate',statValue(fmt(s.winrate,2),'%')]];
  const group=(title,items)=>`<section class="profile-stat-group"><div class="eyebrow">${title}</div><div class="profile-stat-grid">${items.map(([a,b])=>profileStatCard(a, b===undefined?'—':b)).join('')}</div></section>`;
  return `<div class="profile-page">
    <div class="profile-topbar"><button class="btn ghost" data-nav="players">← Voltar</button></div>
    <header class="profile-hero">
      <div class="profile-hero-identity">${avatarHtml(p.id,'xl')}<div><div class="eyebrow">PERFIL DO JOGADOR</div><h2>${esc(p.nickname||p.name)}</h2><p>${esc(p.name)}${p.steamId?` · SteamID64 ${esc(p.steamId)}`:''}</p></div></div>
      <div class="profile-rank"><span>NÍVEL ${p.level ?? 0}</span><strong>${p.points ?? 0}</strong><small>Elo</small></div>
    </header>
    <section class="profile-competitive">
      <div class="profile-featured">${profileStatCard('K/D Ratio',fmt(s.kd),'featured')}${profileStatCard('ADR',fmt(s.adr,1),'featured')}${profileStatCard('HS%',statValue(fmt(s.hsPercent,1),'%'),'featured')}${profileStatCard('Win Rate',statValue(fmt(s.winrate,2),'%'),'featured')}${profileStatCard('Partidas',s.matches||0,'featured')}${profileStatCard('Rating',fmt(s.rating),'featured')}</div>
      <div class="profile-record"><span>VITÓRIAS</span><strong>${s.wins||0}</strong><span>DERROTAS</span><strong>${s.losses||0}</strong></div>
    </section>
    <div class="profile-groups">${group('COMBATE',combat)}${group('PRECISÃO',precision)}${group('IMPACTO',impact)}${group('ROUNDS',rounds)}</div>
    <section class="panel profile-history-panel"><div class="section-head"><div><div class="eyebrow">HISTÓRICO RECENTE</div><h3>Últimas partidas</h3></div></div>
      ${recent.length?`<div class="recent-list">${recent.map(m=>{const e=m.players.find(x=>x.playerId===p.id);return `<button class="recent-row profile-match-row" data-view-match="${m.id}"><div class="recent-match-main">${avatarHtml(p.id)}<div><b>${esc(m.map||'Mapa não informado')}</b><small>${formatDate(m.createdAt)} · ${m.score?`${m.score.team1} × ${m.score.team2}`:'—'}${m.winnerTeam?` · Vitória do Time ${m.winnerTeam}`:''}</small></div></div><span>${e?`K/D ${fmt(calculateDerivedStats(e.stats).kd)} · ADR ${fmt(calculateDerivedStats(e.stats).adr,1)} · Rating ${fmt(e.stats.rating)}`:'—'}</span></button>`}).join('')}</div>`:'<p class="muted">Nenhuma partida no histórico.</p>'}
    </section>
    <section class="panel profile-history-panel"><div class="section-head"><div><div class="eyebrow">PROGRESSÃO</div><h3>Histórico de Elo</h3><p class="muted">Cada partida mostra o Elo antes, a variação, o Elo depois e o Level calculado.</p></div></div>
      ${p.eloHistory?.length?`<div class="elo-history-list">${[...p.eloHistory].reverse().map(h=>`<div class="elo-history-row"><div><b>${h.result==='win'?'Vitória':h.result==='loss'?'Derrota':'Sem resultado'}</b><small>${formatDate(h.date)} · KDA ${fmt(h.kda)}</small></div><span>${h.eloBefore} Elo</span><strong class="signed ${h.eloDelta>0?'positive':h.eloDelta<0?'negative':''}">${h.eloDelta>0?'+':''}${h.eloDelta}</strong><span>${h.eloAfter} Elo</span><span>LVL ${h.levelBefore} → ${h.levelAfter}</span></div>`).join('')}</div>`:'<p class="muted">Nenhuma alteração de Elo registrada ainda.</p>'}
    </section>
  </div>`;
}
function importPreview(match){
  const unknown=importUnknownPlayers;
  return `<div class="import-preview"><div class="section-head"><div><div class="eyebrow">PARTIDA PROCESSADA</div><h3>Revise antes de salvar</h3></div></div>
    <div class="panel import-map-panel"><label>MAPA JOGADO<select id="import-map"><option value="">Selecione o mapa</option>${state.maps.map(x=>`<option value="${esc(x.name)}" ${String(x.name).toLowerCase()===String(match.map||'').toLowerCase()?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div><div class="import-summary"><span>Mapa <b id="import-map-label">${esc(match.map||'Não informado')}</b></span><span>Placar <b id="import-score-label">${match.score?`${match.score.team1} × ${match.score.team2}`:'Definir manualmente'}</b></span><span>Jogadores <b>${match.players.length}</b></span><span>Rounds <b>${match.rounds||0}</b></span></div>
    <div class="panel manual-score-panel"><div class="eyebrow">ADMINISTRADOR</div><h3>Definir placar manualmente</h3><p class="muted">O CSV fornece as estatísticas, mas não o resultado. Informe o placar real antes de salvar.</p><div class="score-editor"><label>Time 1 (${esc(match.teams[0]?.name||'Time 1')})<input id="manual-score-1" type="number" min="0" value="${match.score?.team1??''}" placeholder="0"></label><strong>×</strong><label>Time 2 (${esc(match.teams[1]?.name||'Time 2')})<input id="manual-score-2" type="number" min="0" value="${match.score?.team2??''}" placeholder="0"></label></div></div>
    ${unknown.length?`<div class="warning-box"><b>⚠️ ${unknown.length} jogador${unknown.length===1?'':'es'} não encontrado${unknown.length===1?'':'s'}</b><p>Cadastre pelo SteamID antes de confirmar a partida.</p>${unknown.map(u=>`<div class="unknown-player"><span><b>${esc(u.nickname)}</b><small>${esc(u.steamId)}</small></span><button class="btn small" data-create-import-player="${esc(u.steamId)}">Cadastrar jogador</button></div>`).join('')}</div>`:''}
    <div class="import-table">${match.players.map(p=>{const known=findPlayerBySteamId(state,p.steamId);const d=calculateDerivedStats(p.stats);return `<div class="import-row"><span class="import-player-cell">${known?avatarHtml(known.id):`<span class="avatar">${esc((p.nickname||'?').slice(0,2).toUpperCase())}</span>`}<span><b>${esc(p.nickname)}</b><small>${known?esc(known.name):`Não cadastrado · ${esc(p.steamId)}`}</small></span></span><span>Time ${p.team}</span><span>${p.stats.kills??0} K · ${p.stats.deaths??0} D · ${p.stats.assists??0} A · K/D ${fmt(d.kd)} · KDA ${fmt(d.kda)} · ADR ${fmt(d.adr,1)} · HS ${fmt(d.hsPercent,1)}% · Rating ${fmt(d.rating)}</span></div>`}).join('')}</div>
    <div class="import-actions"><button class="btn ghost" id="cancel-import">Cancelar</button><button class="btn primary" id="confirm-import" ${unknown.length?'disabled':''}>Confirmar e salvar</button></div>
  </div>`;
}
async function processImport(){
  const file=$('#match-import-file')?.files?.[0];
  const raw=$('#match-import-data')?.value||'';
  try{
    if(!file && !raw) throw new Error('Selecione um ZIP da partida ou cole um JSON.');
    const parsed=file && /\.zip$/i.test(file.name)
      ? await parseMatchZip(file)
      : /\.csv$/i.test(file?.name||'') ? parseMatchCsv(await file.text()) : parseMatchImport(raw || await file.text());
    const known=parsed.players.filter(p=>findPlayerBySteamId(state,p.steamId));
    importUnknownPlayers=parsed.players.filter(p=>!findPlayerBySteamId(state,p.steamId));
    if(parsed.id && state.matches.some(m=>m.externalId===parsed.id || m.id===parsed.id)) throw new Error('⚠️ ESTA PARTIDA JÁ FOI IMPORTADA.');
    if(!parsed.id){
      const candidate={...parsed,players:parsed.players.map(p=>({...p,playerId:findPlayerBySteamId(state,p.steamId)?.id||null}))};
      if(isDuplicateMatch(state,candidate)) throw new Error('⚠️ ESTA PARTIDA JÁ FOI IMPORTADA.');
    }
    processedImport=parsed;
    render();
    toast(`Partida processada. ${known.length}/${parsed.players.length} jogadores identificados.`);
  }catch(e){toast(e.message||'Falha ao processar a partida.',true)}
}
function createImportPlayer(steamId){
  const p=processedImport?.players.find(x=>x.steamId===steamId);
  if(!p)return;
  if(findPlayerBySteamId(state,steamId))return;
  state.players.push({id:uid(),name:p.nickname,registeredName:p.nickname,nickname:p.nickname,steamId:p.steamId,steamId3:p.steamId3||null,...newPlayerDefaults(),avatar:'',available:true,stats:{}});
  importUnknownPlayers=importUnknownPlayers.filter(x=>x.steamId!==steamId);
  persist();
}
function confirmImport(){
  if(!processedImport)return;
  const mapValue=document.querySelector('#import-map')?.value || processedImport.map || '';
  if(!mapValue.trim()){toast('Informe o mapa jogado antes de salvar.',true);return;}
  processedImport.map=mapValue.trim();
  const s1=document.querySelector('#manual-score-1')?.value;
  const s2=document.querySelector('#manual-score-2')?.value;
  if(s1!==undefined && s2!==undefined && (s1==='' || s2==='')) { toast('Informe o placar dos dois times antes de salvar.',true); return; }
  if(s1!==undefined && s2!==undefined) { const a=Number(s1),b=Number(s2); processedImport.score={team1:a,team2:b}; processedImport.winnerTeam=a===b?null:(a>b?1:2); processedImport.rounds=a+b; processedImport.players.forEach(p=>p.stats.rounds=a+b); processedImport.teams.forEach((t,i)=>t.players.forEach(p=>p.stats.rounds=a+b)); }
  const unknown=processedImport.players.filter(p=>!findPlayerBySteamId(state,p.steamId));
  if(unknown.length){toast('Cadastre todos os jogadores desconhecidos antes de salvar.',true);return}
  const match={
    id:processedImport.id||crypto.randomUUID(),
    externalId:processedImport.externalId||processedImport.id||null,
    createdAt:processedImport.createdAt,
    map:processedImport.map,
    score:processedImport.score,
    winnerTeam:processedImport.winnerTeam,
    duration:processedImport.duration,
    rounds:processedImport.rounds,
    teams:processedImport.teams.map(t=>({id:t.id,name:t.name,playerIds:t.players.map(p=>findPlayerBySteamId(state,p.steamId)?.id)})),
    players:processedImport.players.map(p=>({playerId:findPlayerBySteamId(state,p.steamId).id,steamId:p.steamId,steamId3:p.steamId3,nickname:p.nickname,team:p.team,stats:{...p.stats,...calculateDerivedStats(p.stats)}})),
    rawMatchData:processedImport.source,
    importedAt:new Date().toISOString()
  };
  match.fingerprint=matchFingerprint(match);
  if(isDuplicateMatch(state,match)){toast('⚠️ ESTA PARTIDA JÁ FOI IMPORTADA.',true);return}
  state.matches.push(match);
  rebuildPlayerStats(state);
  processedImport=null;importUnknownPlayers=[];
  persist();nav('history');toast('Partida salva e estatísticas atualizadas.');
}
function finishCurrentMatch(){
  if(!state.match)return;
  const map=(document.querySelector('#finish-map')?.value||'').trim();
  const s1=document.querySelector('#finish-score-1')?.value; const s2=document.querySelector('#finish-score-2')?.value;
  if(!map){toast('Informe o mapa jogado antes de salvar.',true);return;}
  if(s1==='' || s2===''){toast('Informe o placar dos dois times antes de salvar.',true);return;}
  const a=Number(s1),b=Number(s2);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0){toast('Placar inválido.',true);return;}
  const m=state.match; m.map=map; m.score={team1:a,team2:b}; m.winnerTeam=a===b?null:(a>b?1:2); m.rounds=a+b; m.status='finished';
  const players=[...m.captainIds.map((id,i)=>({playerId:id,team:i+1})), ...m.teams.a.map(id=>({playerId:id,team:1})), ...m.teams.b.map(id=>({playerId:id,team:2}))];
  const match={id:m.id,externalId:null,createdAt:m.createdAt,map:m.map,score:m.score,winnerTeam:m.winnerTeam,duration:null,rounds:m.rounds,teams:[{id:1,name:teamName(0),playerIds:m.captainIds[0]?[m.captainIds[0],...m.teams.a]:m.teams.a},{id:2,name:teamName(1),playerIds:m.captainIds[1]?[m.captainIds[1],...m.teams.b]:m.teams.b}],players:players.map(x=>({playerId:x.playerId,steamId:playerById(state,x.playerId)?.steamId||null,steamId3:playerById(state,x.playerId)?.steamId3||null,nickname:playerById(state,x.playerId)?.nickname||playerName(x.playerId),team:x.team,stats:{rounds:m.rounds}})),rawMatchData:{format:'manual-match'},importedAt:new Date().toISOString()};
  match.fingerprint=matchFingerprint(match); if(!isDuplicateMatch(state,match)) state.matches.push(match);
  rebuildPlayerStats(state); persist(); nav('history'); toast('Partida finalizada, placar e mapa salvos.');
}

function deleteImportedMatch(id){
  if(!confirm('Excluir esta partida e recalcular as estatísticas dos jogadores?'))return;
  state.matches=state.matches.filter(m=>m.id!==id);
  rebuildPlayerStats(state);persist();toast('Partida excluída e estatísticas recalculadas.');
}
function resolveMatchPlayerId(entry){
  if(entry?.playerId && playerById(state,entry.playerId)) return entry.playerId;
  const bySteam=findPlayerBySteamId(state,entry?.steamId);
  return bySteam?.id || entry?.playerId || null;
}

function matchTeamEntries(m, teamNo){
  const players=Array.isArray(m?.players)?m.players:[];
  const teams=Array.isArray(m?.teams)?m.teams:[];
  const team=teams.find((t,index)=>Number(t?.id)===Number(teamNo) || index+1===Number(teamNo)) || {};
  const teamName=String(team.name||'').trim().toLowerCase();
  const playerIds=new Set((team.playerIds||[]).map(String));
  const teamSteamIds=new Set((team.players||[]).map(p=>String(p.steamId||p.steamID64||p.steamid64||'')));

  return players.filter(p=>{
    const value=String(p?.team??'').trim();
    if(value===String(teamNo)) return true;
    if(value.toLowerCase()===teamName && teamName) return true;
    const pid=resolveMatchPlayerId(p);
    if(pid && playerIds.has(String(pid))) return true;
    const sid=String(p?.steamId||p?.steamID64||p?.steamid64||'');
    if(sid && teamSteamIds.has(sid)) return true;
    return false;
  }).map(p=>({...p,playerId:resolveMatchPlayerId(p)}));
}

function matchPlayerRow(m,p){
  const d=calculateDerivedStats(p.stats||{});
  const kd=fmt(d.kd), adr=fmt(d.adr,1), hs=fmt(d.hsPercent,1), rating=fmt(p.stats?.rating ?? d.rating);
  const score=Number(p.stats?.kills||0)-Number(p.stats?.deaths||0);
  const player=playerById(state,p.playerId);
  const avatar=player?avatarHtml(player.id):`<span class="avatar">${esc((p.nickname||'?').slice(0,2).toUpperCase())}</span>`;
  const clickable=p.playerId?` data-profile-player="${esc(p.playerId)}"`:'';
  return `<div class="match-player-row"${clickable}>
    <div class="match-player-name">${avatar}<span><b>${esc(p.nickname||playerName(p.playerId))}</b><small>${esc(player?.name||'Jogador importado')}</small></span></div>
    <span>${p.stats?.kills??0}</span><span>${p.stats?.assists??0}</span><span>${p.stats?.deaths??0}</span><span class="signed ${score>=0?'positive':'negative'}">${score>0?'+':''}${score}</span><span>${adr}</span><span>${kd}</span><span>${hs}%</span><strong>${rating}</strong>
  </div>`;
}
function showImportedMatch(id){
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  const win=Number(m.winnerTeam)||null;
  const teamNameByNo=(teamNo)=>m.teams?.find((t,index)=>Number(t?.id)===Number(teamNo)||index+1===Number(teamNo))?.name || `Time ${teamNo}`;
  const teamBlock=(teamNo)=>{
    const players=matchTeamEntries(m,teamNo).sort((a,b)=>Number(b.stats?.rating||calculateDerivedStats(b.stats||{}).rating||0)-Number(a.stats?.rating||calculateDerivedStats(a.stats||{}).rating||0)||Number(b.stats?.kills||0)-Number(a.stats?.kills||0)||Number(b.stats?.score||0)-Number(a.stats?.score||0));
    return `<section class="match-team-block ${win===teamNo?'winner':''}"><div class="match-team-header"><div><div class="eyebrow">TIME ${teamNo}</div><h3>${esc(teamNameByNo(teamNo))}${win===teamNo?' 🏆':''}</h3></div><strong>${m.score?m.score[`team${teamNo}`]:'—'}</strong></div><div class="match-table-wrap"><div class="match-table match-table-head"><span>Jogador</span><span>K</span><span>A</span><span>D</span><span>+/-</span><span>ADR</span><span>K/D</span><span>HS%</span><span>Rating</span></div>${players.length?players.map(p=>matchPlayerRow(m,p)).join(''):'<div class="muted match-empty">Nenhum jogador registrado.</div>'}</div></section>`;
  };
  const modal=document.createElement('div');modal.className='modal-backdrop';modal.innerHTML=`<div class="modal-card match-result-modal"><div class="match-result-hero"><div><div class="eyebrow">${esc(m.map||'MAPA NÃO INFORMADO')}</div><h2>${m.score?`${m.score.team1} × ${m.score.team2}`:'Resultado não informado'}</h2><p>${win?`Time ${win} venceu`:'Vencedor não informado'} · ${formatDate(m.createdAt)}</p></div><button class="btn ghost" id="close-match-modal">Fechar</button></div><div class="match-meta"><span><b>Mapa</b>${esc(m.map||'Mapa não informado')}</span><span><b>Rounds</b>${m.rounds||'—'}</span><span><b>Data</b>${formatDate(m.createdAt)}</span>${m.duration?`<span><b>Duração</b>${esc(m.duration)}</span>`:''}</div><div class="match-teams-result">${teamBlock(1)}${teamBlock(2)}</div></div>`;
  document.body.appendChild(modal);$('#close-match-modal').onclick=()=>modal.remove();modal.querySelectorAll('[data-profile-player]').forEach(b=>b.onclick=()=>{modal.remove();selectedProfileId=b.dataset.profilePlayer;nav('profile')});
}

function bind(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>nav(b.dataset.nav));
  $('#new-match')?.addEventListener('click',()=>{ if(confirm('Iniciar uma nova partida? A partida atual será descartada.')){state.match=newMatch();persist();nav('match');}});
  $('#start-match')?.addEventListener('click',()=>{ensureMatch();nav('match')}); $('#open-match')?.addEventListener('click',()=>nav('match'));
  document.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>toggleSelected(b.dataset.player));
  $('#select-players')?.addEventListener('click',()=>{ if(!state.match) state.match=newMatch(); nav('match'); });
  $('#go-captains')?.addEventListener('click',()=>goCaptains()); $('#to-captains')?.addEventListener('click',()=>goCaptains());
  document.querySelectorAll('[data-captain]').forEach(b=>b.onclick=()=>toggleCaptain(b.dataset.captain)); $('#to-draw')?.addEventListener('click',()=>{state.match.status='draw';persist()});
  $('#run-draw')?.addEventListener('click',runDraw); document.querySelectorAll('[data-draft-pick]').forEach(b=>b.onclick=()=>doDraft(b.dataset.draftPick)); $('#confirm-teams')?.addEventListener('click',()=>{try{state=confirmTeams(state);persist()}catch(e){toast(e.message,true)}});
  $('#finish-match')?.addEventListener('click',finishCurrentMatch);
  $('#import-map')?.addEventListener('change',e=>{ if(processedImport){ processedImport.map=e.target.value.trim()||null; render(); }});
  $('#finish-map')?.addEventListener('change',e=>{ if(state.match) state.match.map=e.target.value.trim()||null; }); document.querySelectorAll('[data-map-action]').forEach(b=>b.onclick=()=>mapAction(b.dataset.mapAction));
  $('#player-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);const defaults=newPlayerDefaults(); state.players.push({id:uid(),name:f.get('name').trim(),registeredName:f.get('name').trim(),nickname:f.get('nickname').trim(),steamId:f.get('steamId').trim()||null,level:defaults.level,points:defaults.points,avatar:f.get('avatar').trim(),available:true,stats:{}});persist();e.target.reset();});
  $('#map-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);state.maps.push({id:uid(),name:f.get('name').trim(),image:f.get('image').trim()});persist();e.target.reset();});
  document.querySelectorAll('[data-edit-player]').forEach(b=>b.onclick=()=>editPlayer(b.dataset.editPlayer)); document.querySelectorAll('[data-toggle-player]').forEach(b=>b.onclick=()=>{const p=playerById(state,b.dataset.togglePlayer);p.available=!p.available;persist()}); document.querySelectorAll('[data-remove-player]').forEach(b=>b.onclick=()=>{if(confirm('Remover este jogador?')){state.players=state.players.filter(p=>p.id!==b.dataset.removePlayer);persist()}}); document.querySelectorAll('[data-remove-map]').forEach(b=>b.onclick=()=>{if(confirm('Remover este mapa?')){state.maps=state.maps.filter(m=>m.id!==b.dataset.removeMap);persist()}});
  $('#add-pb-step')?.addEventListener('click',()=>{state.pickBanConfig.push({team:state.pickBanConfig.length%2+1,type:'BAN'});persist()}); $('#reset-pb-config')?.addEventListener('click',()=>{if(confirm('Limpar toda a sequência?')){state.pickBanConfig=[];persist()}}); document.querySelectorAll('[data-remove-step]').forEach(b=>b.onclick=()=>{state.pickBanConfig.splice(Number(b.dataset.removeStep),1);persist()}); document.querySelectorAll('[data-config-team]').forEach(s=>s.onchange=()=>{state.pickBanConfig[Number(s.dataset.configTeam)].team=Number(s.value);persist()}); document.querySelectorAll('[data-config-type]').forEach(s=>s.onchange=()=>{state.pickBanConfig[Number(s.dataset.configType)].type=s.value;persist()});
  $('#cancel-match')?.addEventListener('click',()=>{if(confirm('Cancelar e apagar a partida atual?')){state.match=null;persist()}}); $('#reset-draft')?.addEventListener('click',resetDraft); $('#reset-pb')?.addEventListener('click',resetPickBan);
  document.querySelectorAll('[data-profile-player]').forEach(b=>b.onclick=()=>{selectedProfileId=b.dataset.profilePlayer;nav('profile')});
  $('#process-import')?.addEventListener('click',processImport);
  $('#match-import-file')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(/\.zip$/i.test(file.name)){
      $('#match-import-data').value=`ZIP selecionado: ${file.name} · ${(file.size/1024).toFixed(1)} KB`;
      toast('ZIP selecionado. Clique em Processar partida.');
    } else {
      $('#match-import-data').value=await file.text();
    }
  });
  $('#confirm-import')?.addEventListener('click',confirmImport);
  $('#cancel-import')?.addEventListener('click',()=>{processedImport=null;importUnknownPlayers=[];render()});
  document.querySelectorAll('[data-create-import-player]').forEach(b=>b.onclick=()=>createImportPlayer(b.dataset.createImportPlayer));
  document.querySelectorAll('[data-delete-match]').forEach(b=>b.onclick=()=>deleteImportedMatch(b.dataset.deleteMatch));
  document.querySelectorAll('[data-view-match]').forEach(b=>b.onclick=()=>showImportedMatch(b.dataset.viewMatch));

}

function editPlayer(id){const p=playerById(state,id);if(!p)return;const name=prompt('Nickname:',p.name);if(name===null)return;const points=prompt('Elo:',p.points);if(points===null)return;const avatar=prompt('URL do avatar (opcional):',p.avatar||'');if(avatar===null)return;const steamId=prompt('SteamID64 (opcional):',p.steamId||'');if(steamId===null)return;p.name=name.trim()||p.name;const nextElo=Number(points);p.points=Number.isFinite(nextElo)?Math.max(0,nextElo):p.points;normalizePlayerElo(p);p.avatar=avatar.trim();p.steamId=steamId.trim()||null;p.registeredName=p.name;persist()}
function toggleSelected(id){ensureMatch();const m=state.match;if(m.status!=='selection')return;if(m.selectedPlayerIds.includes(id))m.selectedPlayerIds=m.selectedPlayerIds.filter(x=>x!==id);else if(m.selectedPlayerIds.length<10)m.selectedPlayerIds.push(id);else toast('Já existem 10 jogadores selecionados.',true);persist();}
function goCaptains(){if(state.match.selectedPlayerIds.length!==10){toast('Selecione exatamente 10 jogadores.',true);return}state.match.status='captains';persist()}
function toggleCaptain(id){const m=state.match;if(m.status!=='captains')return;if(m.captainIds.includes(id))m.captainIds=m.captainIds.filter(x=>x!==id);else if(m.captainIds.length<2)m.captainIds.push(id);else toast('Já existem 2 capitães.',true);persist()}
function runDraw(){ if(draftDrawBusy)return; draftDrawBusy=true;render();setTimeout(()=>{const winner=state.match.captainIds[Math.floor(Math.random()*2)];state.match.firstCaptainId=winner;state.match.status='draw';draftDrawBusy=false;persist();setTimeout(()=>{try{state=startDraft(state);persist()}catch(e){toast(e.message,true)}},2400)},1400); }
function doDraft(id){try{state=draftPick(state,id);persist()}catch(e){toast(e.message,true)}}
function mapAction(id){try{const m=state.match;const step=state.pickBanConfig[m.pickBan.index];state=doPickBan(state,id,m.captainIds[step.team===1?0:1]);persist()}catch(e){toast(e.message,true)}}
function resetDraft(){if(!state.match)return;if(!confirm('Reiniciar o Draft?'))return;const m=state.match;m.status='captains';m.firstCaptainId=null;m.teams={a:[],b:[]};m.draft={round:0,picks:[],available:[],currentCaptainId:null,pickCount:0};m.history=m.history.filter(h=>h.type!=='DRAFT');persist()}
function resetPickBan(){if(!state.match)return;if(!confirm('Reiniciar o Pick & Ban?'))return;state.match.status='pickban';state.match.pickBan={index:0,actions:[],remainingMapIds:state.maps.map(x=>x.id),complete:false};state.match.history=state.match.history.filter(h=>h.type!=='PICK'&&h.type!=='BAN');persist()}

bootstrap();
