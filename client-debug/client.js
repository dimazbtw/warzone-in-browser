/**
 * Cliente de DEBUG (apresentação apenas). Envia intenções e desenha o estado
 * recebido. Nenhuma regra de jogo é decidida aqui.
 */
import { C2S, S2C } from '../shared/protocol.js';

const $ = id => document.getElementById(id);
const cv = $('c'), g = cv.getContext('2d');
const resize = () => { cv.width = innerWidth; cv.height = innerHeight; }; resize(); addEventListener('resize', resize);

const S = { ws: null, id: null, token: sessionStorage.getItem('zr_token'), map: null, loot: new Map(), snap: null, lobby: null, feed: [], zoom: 3, seq: 0, center: '', centerT: 0, cfg: null, render: new Map() };
const keys = {}; let mouse = { x: 0, y: 0, down: false, ads: false };
const RAR = { common: '#bbb', uncommon: '#6fd16f', rare: '#4fa8ff', epic: '#b36bff', legendary: '#ffb13a' };

// ---------------- conexão ----------------
function connect(name, party) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => send(C2S.HELLO, { name, party, token: S.token });
  ws.onmessage = e => onMsg(JSON.parse(e.data));
  ws.onclose = () => { announce('CONEXÃO PERDIDA — reconectando...', 99); setTimeout(() => connect(name, party), 1500); };
}
const send = (t, p = {}) => S.ws?.readyState === 1 && S.ws.send(JSON.stringify({ t, ...p }));

function onMsg(m) {
  switch (m.t) {
    case S2C.WELCOME: S.id = m.id; S.token = m.token; sessionStorage.setItem('zr_token', m.token); if (m.map) S.map = m.map; if (m.config) S.cfg = m.config;
      $('join').style.display = 'none'; $('help').style.display = 'block'; $('end').style.display = 'none';
      if (m.reconnected) announce('RECONECTADO', 2); else if (S.center.startsWith('CONEX')) announce('', 0); break;
    case S2C.LOBBY: S.lobby = m; S.snap = null; renderLobby(); break;
    case S2C.MATCH_START: S.boards = new Map((m.boards ?? []).map(b => [b.id, b])); S.stations = m.stations ?? []; S.loot = new Map(m.loot.map(i => [i.id, i])); $('lobby').style.display = 'none'; announce('A AERONAVE DECOLOU — ESPAÇO PARA SALTAR', 4); break;
    case S2C.SNAPSHOT: S.snap = m; for (const o of m.others) { const r = S.render.get(o.id) ?? { x: o.x, z: o.z }; r.tx = o.x; r.tz = o.z; S.render.set(o.id, r); } break;
    case S2C.EVENT: onEvent(m); break;
    case S2C.ERROR: announce(`ERRO: ${m.error}`, 3); if (m.error === 'partida em andamento') { sessionStorage.removeItem('zr_token'); } break;
    case 'ping2': send('pong2'); break;
  }
}

function onEvent(e) {
  const me = S.id;
  switch (e.type) {
    case 'lootSpawned': S.loot.set(e.item.id, e.item); break;
    case 'lootRemoved': S.loot.delete(e.id); break;
    case 'killfeed': feed(`${e.attacker ?? '☣'} ✖ ${e.victim}`, e.attackerId === me || e.victimId === me); break;
    case 'damage': if (e.attackerId === me) S.hit = { t: performance.now(), head: e.part === 'head', broke: e.armorBroken }; if (e.victimId === me && e.source !== 'zone') S.hurt = { t: performance.now(), x: e.fromX, z: e.fromZ }; break;
    case 'downed': if (e.victimId === me) announce('VOCÊ FOI ABATIDO — aguarde um aliado', 3); else if (e.attackerId === me) announce('INIMIGO ABATIDO', 1.5); break;
    case 'revived': if (e.playerId === me) announce('REVIVIDO!', 2); break;
    case 'awaitingRespawn': if (e.playerId === me) announce('ELIMINADO — AGUARDANDO RETORNO', 3); break;
    case 'respawned': if (e.playerId === me) announce('DE VOLTA À AÇÃO!', 2.5); break;
    case 'resurgenceDisabled': announce('RESSURGIMENTO DESATIVADO — mortes são definitivas', 5); break;
    case 'zonePhase': announce(`FASE ${e.phase + 1}/${e.total}: nova zona marcada`, 3); break;
    case 'zoneClosing': announce('A ZONA ESTÁ FECHANDO', 2.5); break;
    case 'squadEliminated': if (S.snap?.you.squad === e.squadId) announce(`SEU SQUAD FOI ELIMINADO — #${e.placement}`, 5); break;
    case 'matchEnded': showEnd(e); break;
    case 'contractBoard': { const b = S.boards?.get(e.id); if (b) b.taken = e.taken; break; }
    case 'contractStarted': announce(`CONTRATO: ${e.contract.name}`, 3); break;
    case 'contractCompleted': announce(`CONTRATO CONCLUÍDO +$${e.reward.cash} +${e.reward.xp}XP`, 3); break;
    case 'contractFailed': announce(`CONTRATO: ${e.reason}`, 2.5); break;
    case 'purchase': announce(`COMPRADO: ${e.name}`, 2); break;
    case 'purchaseFailed': announce(`COMPRA: ${e.reason}`, 2); break;
    case 'explosion': S.boom = { ...e, t: performance.now() }; break;
  }
}

// ---------------- input ----------------
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  const k = e.code;
  if (k === 'KeyR') send(C2S.RELOAD);
  if (k === 'Digit1') send(C2S.SWITCH, { slot: 'primary' });
  if (k === 'Digit2') send(C2S.SWITCH, { slot: 'secondary' });
  if (k === 'KeyQ') send(C2S.USE_PLATE);
  if (k === 'KeyH') send(C2S.USE_HEAL);
  if (k === 'KeyG') send(C2S.THROW, aimAngles());
  if (k === 'BracketRight') send(C2S.SPECTATE, { dir: 1 });
  if (k === 'BracketLeft') send(C2S.SPECTATE, { dir: -1 });
  if (k === 'KeyF') { const y = S.snap?.you; const b = y && [...(S.boards?.values() ?? [])].find(b => !b.taken && Math.hypot(b.x - y.x, b.z - y.z) < 2.5); if (b) send(C2S.CONTRACT, { boardId: b.id }); }
  if (k === 'KeyB') toggleShop();
  if (k === 'KeyE') { const it = nearestLoot(); if (it) send(C2S.PICKUP, { lootId: it.id }); }
  if (k === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; if (e.button === 2) mouse.ads = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.ads = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { S.zoom = Math.max(0.6, Math.min(8, S.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); });

function viewCenter() { const y = S.snap?.you; if (!y) return { x: 0, z: 0 }; const sp = y.spectating && S.render.get(y.spectating); return sp ? { x: sp.x, z: sp.z } : { x: y.x, z: y.z }; }
function aimAngles() {
  const dx = (mouse.x - cv.width / 2) / S.zoom, dz = (mouse.y - cv.height / 2) / S.zoom;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(-0.4, Math.max(1, Math.hypot(dx, dz))) };
}
function nearestLoot() {
  const y = S.snap?.you; if (!y) return null; let best = null, bd = 2.5;
  for (const it of S.loot.values()) { const d = Math.hypot(it.x - y.x, it.z - y.z); if (d < bd) { bd = d; best = it; } }
  return best;
}
// envia input a 30 Hz (o servidor integra movimento)
setInterval(() => {
  if (!S.snap) return;
  const a = aimAngles();
  // no top-down, W = norte da tela independentemente da mira: converter para o referencial da mira
  const wx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), wz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
  const mx = wx * c - wz * s, mz = wx * s + wz * c;   // mundo → local da mira
  send(C2S.INPUT, { seq: ++S.seq, mx, mz, ...a, sprint: !!keys.ShiftLeft, tac: !!(keys.ShiftLeft && keys.AltLeft), crouch: !!keys.KeyC, prone: !!keys.KeyZ, jump: !!keys.Space, ads: mouse.ads, interact: !!keys.KeyE, plateChain: !!keys.KeyQ });
  if (mouse.down) send(C2S.FIRE, a);
}, 1000 / 30);

// ---------------- UI ----------------
function nearStation() { const y = S.snap?.you; return y && (S.stations ?? []).find(s => Math.hypot(s.x - y.x, s.z - y.z) < 3); }
function toggleShop() {
  const el = $('shop'), st = nearStation();
  if (el.style.display === 'block' || !st) { el.style.display = 'none'; if (!st) announce('APROXIME-SE DE UMA ESTAÇÃO', 1.5); return; }
  const cat = S.cfg?.stations?.catalog ?? {};
  el.innerHTML = `<b class="y">ESTAÇÃO ${st.id}</b> — $${S.snap.you.inv.cash}<br>` + Object.entries(cat).map(([id, it]) => `<button data-item="${id}" style="display:block;width:100%;margin-top:4px;text-align:left">${it.name} — $${it.price}<br><small>${it.desc}</small></button>`).join('');
  el.style.display = 'block';
  el.onclick = ev => { const b = ev.target.closest('[data-item]'); if (b) send(C2S.BUY, { stationId: st.id, item: b.dataset.item }); };
}
$('joinForm').onsubmit = e => { e.preventDefault(); connect($('name').value, $('party').value); };
function announce(t, d) { S.center = t; S.centerT = performance.now() + d * 1000; }
function feed(t, me) { S.feed.unshift({ t, me, at: performance.now() }); S.feed.length = Math.min(S.feed.length, 7); }
function renderLobby() {
  const l = S.lobby, el = $('lobby'); el.style.display = 'block';
  el.innerHTML = `<b class="y">LOBBY</b> — ${l.state === 'countdown' ? `começa em <b>${l.countdown}s</b>` : 'aguardando jogadores'}<br>
  Modo: ${['', 'SOLO', 'DUO', 'TRIO', 'SQUAD'][l.squadSize]} • ${l.players.length} jogadores<hr style="border-color:#333">
  ${l.players.map(p => `<div>${p.id === S.id ? '★ ' : ''}${p.name}${p.bot ? ' <span class="muted">(bot)</span>' : ''}${p.party ? ` <span class="muted">[${p.party}]</span>` : ''}</div>`).join('')}`;
}
function showEnd(e) {
  const won = e.winnerSquad && S.snap?.you.squad === e.winnerSquad;
  $('end').style.display = 'flex';
  $('endTitle').textContent = won ? 'VITÓRIA!' : 'FIM DE PARTIDA'; $('endTitle').style.color = won ? '#e8b13a' : '#ff5050';
  $('endStats').innerHTML = `<table><tr><th>#</th><th>Jogador</th><th>Abates</th><th>Dano</th><th>Sobreviveu</th><th>Contratos</th><th>$ obtido</th></tr>${e.results.slice(0, 16).map(r =>
    `<tr style="${r.id === S.id ? 'color:#e8b13a' : ''}"><td>${r.placement}</td><td>${r.name}</td><td>${r.kills}</td><td>${r.damage}</td><td>${Math.floor(r.survived / 60)}:${String(r.survived % 60).padStart(2, '0')}</td><td>${r.contracts}</td><td>${r.cash}</td></tr>`).join('')}</table><p class="muted" style="margin-top:10px">Novo lobby em alguns segundos…</p>`;
}
const stateName = { alive: 'VIVO', downed: 'ABATIDO', awaiting: 'RETORNANDO', eliminated: 'ELIMINADO', freefall: 'QUEDA', parachute: 'PARAQUEDAS', aircraft: 'AERONAVE' };
function renderHud() {
  const s = S.snap; if (!s) { ['hud-l', 'hud-r', 'top'].forEach(i => $(i).style.display = 'none'); return; }
  ['hud-l', 'hud-r', 'top'].forEach(i => $(i).style.display = 'block');
  const y = s.you, inv = y.inv, z = y.zone;
  const armorPct = y.ar / 1.5, hpPct = y.hp;
  const bearing = ((z.bearing * 180 / Math.PI) + 360) % 360;
  $('top').innerHTML = `VIVOS <b>${s.match.alive}</b> • SQUADS <b>${s.match.squadsLeft}</b> • ABATES <b>${y.stats.kills}</b><br>
    ZONA ${s.zone.phase + 1}/${s.zone.total} ${s.zone.state === 'waiting' ? 'fecha em' : s.zone.state === 'closing' ? 'fechando' : ''} <b>${Math.ceil(s.zone.t)}s</b> • dano ${s.zone.dps}/s<br>
    ${z.outside > 0 ? `<span style="color:#ff8a2a">FORA DA ZONA: ${Math.round(z.outside)}m ➜ ${Math.round(bearing)}°</span>` : '<span class="st-alive">DENTRO DA ZONA</span>'} •
    RESSURGIMENTO <b style="color:${s.match.resurgence ? '#7cff6b' : '#ff5050'}">${s.match.resurgence ? 'ATIVO' : 'DESATIVADO'}</b>`;
  const sq = s.squad.map(m => `<div class="sq"><span class="st-${m.state}">${m.name}${m.connected ? '' : ' ⚠'}</span><span>${stateName[m.state] ?? m.state}${m.respawnIn != null ? ` ${m.respawnIn}s` : ''}${m.bleed != null ? ` ♥${m.bleed}` : ''} • ${m.dist}m</span></div>`).join('');
  $('hud-l').innerHTML = `${sq}${sq ? '<hr style="border-color:#333">' : ''}
    <b>${stateName[y.s] ?? y.s}</b> ${y.st !== 'stand' ? `(${y.st})` : ''} ${y.sprint ? '• correndo' : ''}
    <div class="bar"><i style="width:${armorPct}%;background:#6ec6ff"></i></div>
    <div class="bar"><i style="width:${hpPct}%;background:#fff"></i></div>
    <div class="bar" style="height:3px"><i style="width:${y.stam}%;background:#e8b13a"></i></div>
    ${y.action ? `<div>⏳ ${y.action.type.toUpperCase()} ${(y.action.left).toFixed(1)}s</div>` : ''}`;
  const w = inv && inv[inv.active];
  const def = w && S.cfg?.weapons?.[w.id];
  $('hud-r').innerHTML = inv ? `<div style="font-size:12px" class="muted">${inv.primary ? S.cfg?.weapons?.[inv.primary.id]?.name ?? inv.primary.id : '— vazio —'} | ${inv.secondary ? S.cfg?.weapons?.[inv.secondary.id]?.name ?? inv.secondary.id : ''}</div>
    <div style="font-size:30px"><b>${y.mag}</b> <span class="muted" style="font-size:16px">/ ${def ? inv.ammo[def.ammo] : 0}</span></div>
    <div>${def?.name ?? ''}</div>
    <div>🛡 ${inv.plates} • ✚ ${inv.heals} • 💣 ${inv.lethal} • <b style="color:#7cff6b">$${inv.cash}</b></div>
    <div class="muted" style="font-size:11px">munição: ${Object.entries(inv.ammo).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>` : '';
  const k = y.contract;
  if (k) $('hud-l').innerHTML = `<div style="color:#e8b13a">📋 ${k.name} ${k.type === 'hunt' ? `— alvo: ${k.target}` : ''} ${k.goal > 1 ? `${Math.floor(k.progress)}/${k.goal}` : ''} ${k.contested ? '(CONTESTADO)' : ''} • ${k.timeLeft}s</div>` + $('hud-l').innerHTML;
  if (y.radar) $('hud-l').innerHTML = '<div style="color:#ff6b6b">📡 RADAR ATIVO</div>' + $('hud-l').innerHTML;
  // estados especiais
  let msg = performance.now() < S.centerT ? S.center : '';
  if (y.s === 'awaiting') msg = `RETORNO EM ${Math.ceil(y.respawnIn)}s${y.spectating ? ' — assistindo aliado ([ / ])' : ''}`;
  else if (y.s === 'eliminated') msg = `ELIMINADO — ESPECTADOR${y.spectating ? ' ([ / ] para trocar)' : ''}`;
  else if (y.s === 'downed') msg = `ABATIDO — sangramento ${y.bleed}`;
  else if (y.s === 'aircraft') msg = 'NA AERONAVE — ESPAÇO PARA SALTAR';
  $('center').textContent = msg;
  $('feed').innerHTML = S.feed.filter(f => performance.now() - f.at < 7000).map(f => `<div style="${f.me ? 'color:#e8b13a' : ''}">${f.t}</div>`).join('');
}

// ---------------- render ----------------
function draw() {
  requestAnimationFrame(draw);
  g.fillStyle = '#0d0f0c'; g.fillRect(0, 0, cv.width, cv.height);
  renderHud();
  const s = S.snap; if (!s || !S.map) return;
  const vc = viewCenter(), Z = S.zoom;
  const W = (x, z) => [cv.width / 2 + (x - vc.x) * Z, cv.height / 2 + (z - vc.z) * Z];
  // chão
  const h = S.map.size / 2; let [x0, y0] = W(-h, -h);
  g.fillStyle = '#3f4630'; g.fillRect(x0, y0, S.map.size * Z, S.map.size * Z);
  g.strokeStyle = 'rgba(255,255,255,.05)'; for (let i = -h; i <= h; i += 20) { let [a, b] = W(i, -h), [c, d] = W(i, h); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); [a, b] = W(-h, i); [c, d] = W(h, i); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  for (const [ax, az, bx, bz, bh, cont] of S.map.boxes) { const [a, b] = W(ax, az); g.fillStyle = cont ? '#7a4a36' : `rgb(${120 + bh * 3},${115 + bh * 3},${100 + bh * 2})`; g.fillRect(a, b, (bx - ax) * Z, (bz - az) * Z); }
  g.fillStyle = '#fff'; g.font = '12px sans-serif'; g.textAlign = 'center'; for (const p of S.map.pois) { const [a, b] = W(p.x, p.z); g.fillText(p.name.toUpperCase(), a, b); }
  // zona
  const zn = s.zone; const [zx, zy] = W(zn.x, zn.z);
  g.save(); g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.arc(zx, zy, Math.max(0.1, zn.r * Z), 0, Math.PI * 2, true); g.fillStyle = 'rgba(255,110,0,.28)'; g.fill(); g.restore();
  g.strokeStyle = '#ff8a2a'; g.lineWidth = 2; g.beginPath(); g.arc(zx, zy, Math.max(0.1, zn.r * Z), 0, 7); g.stroke();
  const [tx, ty] = W(zn.to.x, zn.to.z); g.setLineDash([6, 5]); g.strokeStyle = '#fff'; g.beginPath(); g.arc(tx, ty, Math.max(0.1, zn.to.r * Z), 0, 7); g.stroke(); g.setLineDash([]);
  // estações e contratos
  for (const st of S.stations ?? []) { const [a, b] = W(st.x, st.z); g.fillStyle = '#7cff6b'; g.fillRect(a - 5, b - 5, 10, 10); g.fillStyle = '#000'; g.font = 'bold 9px sans-serif'; g.fillText('$', a, b + 3); }
  for (const bd of S.boards?.values() ?? []) { if (bd.taken) continue; const [a, b] = W(bd.x, bd.z); g.fillStyle = '#e8b13a'; g.beginPath(); g.moveTo(a, b - 6); g.lineTo(a + 5, b + 4); g.lineTo(a - 5, b + 4); g.fill(); }
  const kc = s.you.contract;
  if (kc) { g.strokeStyle = '#e8b13a'; g.lineWidth = 2; const pt = kc.lastSeen ?? kc.cache ?? kc.area; if (pt) { const [a, b] = W(pt.x, pt.z); g.beginPath(); g.arc(a, b, Math.max(6, (kc.area?.r ?? (kc.lastSeen ? 15 : 3)) * Z), 0, 7); g.stroke(); } g.lineWidth = 1; }
  // aeronave
  if (s.match.aircraft) { const a = s.match.aircraft, k = Math.min(1, a.t / a.duration); const [p0, q0] = W(a.start.x, a.start.z), [p1, q1] = W(a.end.x, a.end.z);
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(p0, q0); g.lineTo(p1, q1); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(p0 + (p1 - p0) * k, q0 + (q1 - q0) * k, 6, 0, 7); g.fill(); }
  // loot
  for (const it of S.loot.values()) { const [a, b] = W(it.x, it.z); if (a < -10 || b < -10 || a > cv.width + 10 || b > cv.height + 10) continue;
    g.fillStyle = it.type === 'weapon' ? RAR[it.rarity] : it.type === 'cash' ? '#7cff6b' : it.type === 'plate' ? '#6ec6ff' : it.type === 'ammo' ? '#d8c14a' : '#ff7070';
    g.fillRect(a - 2.5, b - 2.5, 5, 5); if (Z > 4) { g.fillStyle = '#ddd'; g.font = '10px sans-serif'; g.fillText(it.type === 'weapon' ? (S.cfg?.weapons?.[it.data.id]?.name ?? it.data.id) : it.type, a, b - 5); } }
  // jogadores
  for (const o of s.others) {
    const r = S.render.get(o.id); r.x += (r.tx - r.x) * 0.35; r.z += (r.tz - r.z) * 0.35;
    const [a, b] = W(r.x, r.z), col = o.a ? '#7cff6b' : '#ff4a4a';
    if (o.rv) { g.strokeStyle = '#ff6b6b'; g.beginPath(); g.arc(a, b, 10, 0, 7); g.stroke(); }
    g.fillStyle = o.s === 'downed' ? '#ffb13a' : col; g.beginPath(); g.arc(a, b, o.s === 'freefall' || o.s === 'parachute' ? 6 : 4.5, 0, 7); g.fill();
    g.strokeStyle = col; g.beginPath(); g.moveTo(a, b); g.lineTo(a - Math.sin(o.yaw) * 12, b - Math.cos(o.yaw) * 12); g.stroke();
    g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(`${o.n}${o.a ? ` ${o.hp}/${o.ar}` : ''}${o.s !== 'alive' ? ` [${stateName[o.s]}]` : ''}${o.y > 1 ? ` ${Math.round(o.y)}m` : ''}`, a, b - 9);
  }
  // eu
  const y = s.you;
  if (!['awaiting', 'eliminated'].includes(y.s)) {
    const [a, b] = W(y.x, y.z), aa = aimAngles();
    g.fillStyle = '#e8b13a'; g.beginPath(); g.arc(a, b, 5.5, 0, 7); g.fill();
    g.strokeStyle = 'rgba(232,177,58,.5)'; g.beginPath(); g.moveTo(a, b); g.lineTo(a - Math.sin(aa.yaw) * 40, b - Math.cos(aa.yaw) * 40); g.stroke();
    if (y.y > 1) { g.fillStyle = '#fff'; g.fillText(`${Math.round(y.y)}m`, a, b + 16); }
  }
  // feedback
  if (S.hit && performance.now() - S.hit.t < 150) { g.strokeStyle = S.hit.head ? '#ff3b3b' : '#fff'; g.lineWidth = 2; const m = 7; g.beginPath(); g.moveTo(mouse.x - m, mouse.y - m); g.lineTo(mouse.x + m, mouse.y + m); g.moveTo(mouse.x + m, mouse.y - m); g.lineTo(mouse.x - m, mouse.y + m); g.stroke(); g.lineWidth = 1; }
  if (S.hurt && performance.now() - S.hurt.t < 600 && S.hurt.x !== undefined) { const ang = Math.atan2(S.hurt.z - y.z, S.hurt.x - y.x); g.fillStyle = 'rgba(255,40,40,.7)'; g.beginPath(); g.arc(cv.width / 2 + Math.cos(ang) * 60, cv.height / 2 + Math.sin(ang) * 60, 7, 0, 7); g.fill(); }
  if (S.boom && performance.now() - S.boom.t < 400) { const [a, b] = W(S.boom.x, S.boom.z); g.fillStyle = 'rgba(255,160,40,.5)'; g.beginPath(); g.arc(a, b, S.boom.radius * Z, 0, 7); g.fill(); }
}
draw();
