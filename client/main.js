import * as THREE from 'three';
import { C2S } from '../shared/protocol.js';
import { MapGeometry } from '../shared/geometry.js';
import { NetClient } from './net/NetClient.js';
import { Prediction } from './game/Prediction.js';
import { Interpolation } from './game/Interpolation.js';
import { InputSystem } from './game/InputSystem.js';
import { World } from './render/World.js';
import { Avatars } from './render/Avatars.js';
import { ViewModel } from './render/ViewModel.js';
import { Effects } from './render/Effects.js';
import { soldierModel, OPERATOR_STYLES } from './render/Models.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { HUDSystem } from './ui/HUDSystem.js';

/**
 * Cliente 3D — apenas apresentação + predição do próprio movimento.
 * Toda decisão de jogo vem do servidor (snapshots/eventos).
 */
const $ = id => document.getElementById(id);
const STEP = 1 / 30;
const AUTO = new Set(['rifle', 'smg']);
const ACTION_OPTS = { reload: { slow: 0.8 }, plate: { slow: 0.6, blocksAds: true }, heal: {}, revive: { slow: 0, blocksAds: true } };
const EYE = { stand: 1.6, crouch: 1.1, prone: 0.45 };

const canvas = $('gl');
const net = new NetClient(), input = new InputSystem(canvas), world = new World(canvas), hud = new HUDSystem(), audio = new AudioSystem();
const avatars = new Avatars(world.scene), effects = new Effects(world.scene), vm = new ViewModel(world.camera);
const G = {
  id: null, name: '', cfg: null, mapView: null, geo: null, pred: null, interp: null, snap: null, inMatch: false,
  boards: new Map(), stations: [], seq: 0, acc: 0, nextFire: 0, shotsSinceSnap: 0, shopOpen: false, lastState: null,
  self: null, hurtT: 0, shake: 0, lastYawSent: 0, mouseDX: 0, mouseDY: 0,
};

// ---------------------------------------------------------------- menu
$('sens').value = input.sensitivity; $('vol').value = audio.volume;
$('sens').oninput = e => { input.sensitivity = +e.target.value; localStorage.setItem('zr_sens', e.target.value); };
$('vol').oninput = e => { audio.volume = +e.target.value; localStorage.setItem('zr_vol', e.target.value); if (audio.master) audio.master.gain.value = audio.volume; };
$('name').value = localStorage.getItem('zr_name') ?? '';
$('joinForm').onsubmit = e => {
  e.preventDefault(); audio.unlock();
  G.name = $('name').value.trim() || 'Jogador'; localStorage.setItem('zr_name', G.name);
  net.connect(G.name, $('party').value.trim());
};
canvas.addEventListener('click', () => { if (G.inMatch && !G.shopOpen) canvas.requestPointerLock?.(); });

// ---------------------------------------------------------------- rede
net.on('welcome', m => {
  G.id = m.id; if (m.config) G.cfg = m.config;
  if (m.map) { G.mapView = m.map; G.geo = MapGeometry.fromView(m.map); world.buildMap(m.map, G.geo); }
  G.pred = new Prediction(G.cfg, G.geo); G.interp = new Interpolation(G.cfg.network.interpolationDelay);
  hud.hideEnd(); if (m.reconnected) hud.notify('RECONECTADO À PARTIDA', 3);
  if (!G.self) { G.self = soldierModel(OPERATOR_STYLES[0]); G.self.visible = false; world.scene.add(G.self); }
});
net.on('lobby', l => { if (!G.inMatch) { $('menu').classList.remove('hidden'); hud.show(false); hud.lobby(l, G.id); } });
net.on('matchStart', p => {
  G.inMatch = true; $('menu').classList.add('hidden'); hud.show(true); hud.hideEnd();
  world.startMatch(p); avatars.clear(); G.boards = new Map((p.boards ?? []).map(b => [b.id, b])); G.stations = p.stations ?? [];
  input.enabled = true; hud.announce('A AERONAVE DECOLOU', 3); audio.warn();
});
net.on('snap', s => {
  const prevState = G.snap?.you.s;
  G.snap = s; G.shotsSinceSnap = 0;
  G.interp.push(s.time, s.others);
  G.pred.reconcile(s.you, net.serverNow());
  if (s.you.s !== prevState) onStateChange(prevState, s.you.s);
});
net.on('status', st => { if (st === 'offline' && G.inMatch) hud.announce('CONEXÃO PERDIDA — RECONECTANDO…', 99); else if (st === 'online') hud.announce('', 0); });
net.on('error', e => hud.notify(`Servidor: ${e}`, 4));
net.on('ev', onEvent);

function onStateChange(from, to) {
  if (to === 'freefall' && from === 'awaiting') { hud.announce('DE VOLTA À AÇÃO!', 2.5); audio.warn(); }
  if (to === 'freefall' && from === 'aircraft') hud.announce('SALTOU!', 1.5);
  if (to === 'alive' && from === 'parachute') audio.step();
  if (to === 'awaiting') hud.announce('ELIMINADO — AGUARDANDO RETORNO', 3);
  if (to === 'eliminated') hud.announce('VOCÊ FOI ELIMINADO', 3);
  if (to === 'downed') hud.announce('VOCÊ FOI ABATIDO', 2);
  if (['freefall', 'aircraft'].includes(to) && G.snap) { input.yaw = G.snap.you.yaw ?? input.yaw; }
}

function nameOf(id) { if (id === G.id) return G.name; return G.snap?.others.find(o => o.id === id)?.n ?? G.snap?.squad.find(m => m.id === id)?.name ?? '?'; }
function isAlly(id) { return G.snap?.squad.some(m => m.id === id); }

function onEvent(e) {
  const me = G.id;
  switch (e.type) {
    case 'lootSpawned': world.addLoot(e.item); break;
    case 'lootRemoved': world.removeLoot(e.id); break;
    case 'contractBoard': { const b = G.boards.get(e.id); if (b) b.taken = e.taken; world.setBoard(e.id, e.taken); break; }
    case 'killfeed': hud.killfeed(`${e.attacker ?? '☣ zona'} ✖ ${e.victim}`, e.attackerId === me || e.victimId === me || isAlly(e.victimId)); if (e.attackerId === me) { hud.hitmarker(false, true); audio.kill(); } break;
    case 'damage':
      if (e.attackerId === me) { hud.hitmarker(e.part === 'head', false); audio.hit(e.part === 'head'); if (e.armorBroken) audio.crack(); }
      if (e.victimId === me) { G.hurtT = performance.now(); if (e.fromX !== undefined && e.source !== 'zone') hud.damageFrom(Math.atan2(e.fromX - G.pred.body.pos.x, -(e.fromZ - G.pred.body.pos.z))); }
      break;
    case 'downed': if (e.attackerId === me) hud.notify(`${nameOf(e.victimId)} ABATIDO`, 1.5); else if (isAlly(e.victimId)) hud.notify(`${nameOf(e.victimId)} FOI ABATIDO — reviva!`, 3); break;
    case 'revived': if (e.playerId === me) hud.announce('REVIVIDO!', 2); else if (e.reviverId === me) hud.notify('ALIADO REVIVIDO', 2); break;
    case 'respawned': if (isAlly(e.playerId)) hud.notify(`${nameOf(e.playerId)} RETORNOU`, 2.5); break;
    case 'resurgenceDisabled': hud.announce('RESSURGIMENTO DESATIVADO', 4); hud.notify('Mortes agora são definitivas', 4); audio.warn(); break;
    case 'zonePhase': hud.notify(`FASE ${e.phase + 1}/${e.total}: nova zona marcada`, 3); break;
    case 'zoneClosing': hud.announce('A ZONA ESTÁ FECHANDO', 2.5); audio.warn(); break;
    case 'squadEliminated': if (G.snap?.you.squad === e.squadId) hud.announce(`SQUAD ELIMINADO — #${e.placement}`, 5); break;
    case 'shot':
      if (e.playerId === me) break;
      audio.shot(e.weapon, e); {
        const d = { x: -Math.sin(e.yaw) * Math.cos(e.pitch), y: Math.sin(e.pitch), z: -Math.cos(e.yaw) * Math.cos(e.pitch) };
        const end = e.hit ?? { x: e.x + d.x * 60, y: e.y + d.y * 60, z: e.z + d.z * 60 };
        effects.tracer({ x: e.x + d.x, y: e.y - 0.1, z: e.z + d.z }, end);
        if (e.hit) effects.spark(new THREE.Vector3(e.hit.x, e.hit.y, e.hit.z), 0xaa2222);
        if (!isAlly(e.playerId)) hud.shotPing(e.x, e.z);
      }
      break;
    case 'explosion': effects.explosion(e, e.radius); audio.explosion(e); { const d = Math.hypot(e.x - G.pred.body.pos.x, e.z - G.pred.body.pos.z); if (d < 35) G.shake = Math.max(G.shake, 0.7 * (1 - d / 35)); } break;
    case 'pickup': if (e.playerId === me) { if (e.type === 'cash') audio.cash(); else audio.ui(); if (!e.auto) hud.notify(pickupText(e), 1.5); } break;
    case 'pickupFailed': if (e.playerId === me && e.reason !== 'gone') hud.notify({ full: 'Inventário cheio', range: 'Muito longe', state: 'Agora não' }[e.reason] ?? e.reason, 1.5); break;
    case 'purchase': hud.notify(e.playerId === me ? `COMPRADO: ${e.name}` : `${nameOf(e.playerId)} comprou ${e.name}`, 2.5); audio.cash(); if (e.playerId === me) renderShop(); break;
    case 'purchaseFailed': if (e.playerId === me) { hud.notify(`Compra: ${e.reason}`, 2); audio.warn(); } break;
    case 'contractStarted': hud.announce(`CONTRATO: ${e.contract.name.toUpperCase()}`, 3); audio.ui(); break;
    case 'contractUpdate': audio.ui(); break;
    case 'contractCompleted': hud.announce(`CONTRATO CONCLUÍDO · +$${e.reward.cash} · +${e.reward.xp} XP`, 3.5); audio.cash(); break;
    case 'contractFailed': if (!e.start || e.playerId === me) hud.notify(`Contrato: ${e.reason}`, 2.5); break;
    case 'plateBroken': if (e.attackerId === me) audio.crack(); break;
    case 'matchEnded': G.inMatch = false; input.enabled = false; document.exitPointerLock?.(); hud.end(e, me, G.snap?.you.squad); break;
  }
}
function pickupText(e) {
  if (e.type === 'weapon') return `Pegou ${G.cfg.weapons[e.data.id]?.name}`;
  return { ammo: `+${e.data.amount} munição`, plate: `+${e.data.amount} placa(s)`, cash: `+$${e.data.amount}`, heal: '+1 cura', lethal: '+1 granada', intel: 'Inteligência coletada' }[e.type] ?? e.type;
}

// ---------------------------------------------------------------- ações
input.on('action', a => {
  if (!G.inMatch || !G.snap) return;
  const you = G.snap.you, pos = G.pred.body.pos;
  switch (a) {
    case 'reload': net.send(C2S.RELOAD); break;
    case 'primary': net.send(C2S.SWITCH, { slot: 'primary' }); break;
    case 'secondary': net.send(C2S.SWITCH, { slot: 'secondary' }); break;
    case 'plate': net.send(C2S.USE_PLATE); break;
    case 'heal': net.send(C2S.USE_HEAL); break;
    case 'lethal': net.send(C2S.THROW, { yaw: input.yaw, pitch: input.pitch }); break;
    case 'interact': { const it = nearestLoot(); if (it) net.send(C2S.PICKUP, { lootId: it.id }); break; }
    case 'contract': { const b = nearBoard(); if (b) net.send(C2S.CONTRACT, { boardId: b.id }); else hud.notify('Nenhum tablet de contrato por perto', 1.5); break; }
    case 'shop': toggleShop(); break;
    case 'map': $('bigmap').classList.toggle('hidden'); break;
    case 'specNext': net.send(C2S.SPECTATE, { dir: 1 }); break;
    case 'specPrev': net.send(C2S.SPECTATE, { dir: -1 }); break;
  }
  void you; void pos;
});
input.on('swap', () => { const inv = G.snap?.you.inv; if (inv) net.send(C2S.SWITCH, { slot: inv.active === 'primary' ? 'secondary' : 'primary' }); });
input.on('fireDown', () => tryFire(true));

function nearestLoot() {
  const p = G.pred.body.pos; let best = null, bd = G.cfg.loot.pickupRange;
  for (const m of world.loot.values()) { const it = m.userData.item; if (it.type === 'intel' && !G.snap.you.contract) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = it; } }
  return best;
}
function nearBoard() { const p = G.pred.body.pos; return [...G.boards.values()].find(b => !b.taken && Math.hypot(b.x - p.x, b.z - p.z) < G.cfg.contracts.interactRange); }
function nearStation() { const p = G.pred.body.pos; return G.stations.find(s => Math.hypot(s.x - p.x, s.z - p.z) < G.cfg.stations.interactRange); }
function toggleShop(force) {
  const st = nearStation();
  G.shopOpen = force ?? (!G.shopOpen && !!st);
  if (!st && force === undefined && !G.shopOpen) hud.notify('Aproxime-se de uma estação de compra', 1.5);
  if (G.shopOpen) document.exitPointerLock?.();
  renderShop();
}
function renderShop() { const st = nearStation(); if (!st) G.shopOpen = false; hud.shop(G.shopOpen, st, G.cfg, G.snap?.you.inv?.cash ?? 0, G.snap?.squad ?? []); }
$('shop').addEventListener('click', e => { const it = e.target.closest('[data-item]'); if (it) net.send(C2S.BUY, { stationId: $('shop').dataset.station, item: it.dataset.item, targetId: it.dataset.target }); });

function tryFire(click) {
  const y = G.snap?.you; if (!y || y.s !== 'alive' || !y.inv || G.shopOpen) return;
  const w = y.inv[y.inv.active]; if (!w) return;
  const def = G.cfg.weapons[w.id], now = performance.now() / 1000;
  if (!click && !AUTO.has(w.id)) return;
  if (now < G.nextFire || y.action?.type === 'plate' || y.action?.type === 'revive') return;
  if (w.mag - G.shotsSinceSnap <= 0) { if (click) { audio.tone(220, 0.04, 0.05); net.send(C2S.RELOAD); } return; }
  G.nextFire = now + 60 / def.rpm; G.shotsSinceSnap++;
  net.send(C2S.FIRE, { yaw: input.yaw, pitch: input.pitch });
  vm.fire(def.recoil); audio.shot(w.id, null, true);
  // traçante local e impacto na parede (cosmético)
  const o = world.camera.getWorldPosition(new THREE.Vector3()), d = world.camera.getWorldDirection(new THREE.Vector3());
  const wall = G.geo.raycast(o, d, def.range), end = o.clone().addScaledVector(d, wall ?? def.range);
  effects.tracer(o.clone().addScaledVector(d, 1.2).add(new THREE.Vector3(0, -0.12, 0)), end); if (wall) effects.spark(end);
  // recuo de câmera (o servidor aplica a dispersão real)
  input.pitch = Math.min(1.5, input.pitch + def.recoil * 0.008 * (y.ads ? 0.6 : 1)); input.yaw += (Math.random() - 0.5) * def.recoil * 0.004;
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta()), time = performance.now() / 1000;
  if (!G.snap || !G.pred || !G.inMatch) { idleCamera(time); world.render(); return; }
  const y = G.snap.you, serverNow = net.serverNow();

  // passos fixos de input → servidor + predição local
  G.acc += dt;
  while (G.acc >= STEP) {
    G.acc -= STEP;
    const inp = input.sample(++G.seq, STEP);
    if (G.shopOpen) Object.assign(inp, { mx: 0, mz: 0, jump: false });
    net.send(C2S.INPUT, inp);
    G.pred.step(inp, STEP, serverNow, ACTION_OPTS[y.action?.type] ?? {});
  }
  if (input.fire) tryFire(false);

  const others = G.interp.sample(serverNow);
  avatars.update(others, dt, time);
  const pos = G.pred.renderPos(G.acc / STEP, dt), body = G.pred.body;
  const inv = y.inv, w = inv?.[inv.active];

  // câmera
  const cam = world.camera, st = y.s;
  let thirdPerson = false, target = pos, tyaw = input.yaw, tpitch = input.pitch;
  if (st === 'aircraft') { thirdPerson = true; target = { x: y.x, y: y.y, z: y.z }; }
  else if (st === 'freefall' || st === 'parachute') thirdPerson = true;
  else if (st === 'awaiting' || st === 'eliminated') {
    const sp = others.find(o => o.id === y.spectating);
    if (sp) { thirdPerson = true; target = sp; tyaw = sp.yaw; tpitch = -0.25; } else { target = { x: G.snap.zone.x, y: 0, z: G.snap.zone.z }; }
  }
  if (thirdPerson) {
    const dist = st === 'aircraft' ? 28 : st === 'freefall' ? 7 : st === 'parachute' ? 9 : 5;
    const hgt = st === 'aircraft' ? 8 : 2.5;
    cam.position.set(target.x + Math.sin(tyaw) * dist * Math.cos(tpitch), target.y + hgt - Math.sin(tpitch) * dist, target.z + Math.cos(tyaw) * dist * Math.cos(tpitch));
    cam.lookAt(target.x, target.y + 1.5, target.z);
  } else if (st === 'awaiting' || st === 'eliminated') {
    cam.position.set(target.x + Math.cos(time * 0.1) * 120, 120, target.z + Math.sin(time * 0.1) * 120); cam.lookAt(target.x, 0, target.z);
  } else {
    const eye = st === 'downed' ? 0.5 : body.slide ? 0.9 : EYE[body.stance] ?? 1.6;
    cam.position.set(pos.x, pos.y + eye, pos.z); cam.rotation.set(input.pitch, input.yaw, 0, 'YXZ');
  }
  if (G.shake > 0) { cam.position.x += (Math.random() - 0.5) * G.shake; cam.position.y += (Math.random() - 0.5) * G.shake; G.shake = Math.max(0, G.shake - dt * 1.5); }
  const sniper = y.ads && w?.id === 'marksman' && st === 'alive';
  const fov = st === 'alive' ? (y.ads ? (sniper ? 22 : 55) : body.sprinting ? 82 : 75) : 75;
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();

  // próprio corpo em 3ª pessoa
  G.self.visible = ['freefall', 'parachute'].includes(st);
  if (G.self.visible) { G.self.position.set(pos.x, pos.y, pos.z); G.self.rotation.y = input.yaw; G.self.userData.chute.visible = st === 'parachute'; G.self.userData.body.rotation.x = st === 'freefall' ? -1.25 : 0; }

  // arma em 1ª pessoa
  vm.setWeapon(st === 'alive' ? w?.id ?? null : null);
  vm.update(dt, { ads: y.ads, sprint: body.sprinting, moving: Math.hypot(body.vel.x, body.vel.z) > 1 && body.grounded, action: y.action?.type, visible: st === 'alive', sniperScope: sniper });

  // áudio
  audio.listener(cam.position, input.yaw); audio.setWind(st === 'freefall' || st === 'parachute', st === 'freefall' ? 1.4 : 0.6);

  // pós-processamento
  const u = world.grade.uniforms, hurt = Math.max(0, 1 - (performance.now() - G.hurtT) / 600);
  u.damage.value = Math.min(1, Math.max(hurt * 0.8, (100 - y.hp) / 120)); u.gas.value += ((y.zone.outside > 0 && !['awaiting', 'eliminated', 'aircraft'].includes(st) ? 1 : 0) - u.gas.value) * Math.min(1, dt * 4);
  u.ads.value += ((y.ads ? 1 : 0) - u.ads.value) * Math.min(1, dt * 8); u.downed.value = st === 'downed' ? 1 : 0;

  // HUD
  const prompt = st === 'alive' ? promptText() : null;
  const def = w && G.cfg.weapons[w.id];
  hud.update({ snap: G.snap, cfg: G.cfg, yaw: input.yaw, pos, mapView: G.mapView, geo: G.geo, stations: G.stations, boards: G.boards, others, myName: G.name, prompt,
    spectatingName: y.spectating && (others.find(o => o.id === y.spectating)?.n), hideCrosshair: y.ads || body.sprinting || st !== 'alive', spread: def ? (def.spreadHip * 400 + 4) * (Math.hypot(body.vel.x, body.vel.z) > 1 ? 1.5 : 1) : 6,
    sniperScope: sniper, netText: `ping ${Math.round(net.rtt * 1000)} ms · correções ${G.pred.corrections}` });
  if (G.shopOpen && !nearStation()) toggleShop(false);

  world.update(dt, G.snap, cam.position, time);
  effects.update(dt);
  world.render();
}
function promptText() {
  const y = G.snap.you, p = G.pred.body.pos;
  const ally = G.snap.others.find(o => o.a && o.s === 'downed' && Math.hypot(o.x - p.x, o.z - p.z) <= G.cfg.downed.reviveRange);
  if (ally) return `<b>[Segure E]</b> Reviver ${ally.n}`;
  const it = nearestLoot();
  if (it) return `<b>[E]</b> ${it.type === 'weapon' ? `${G.cfg.weapons[it.data.id]?.name} <span style="color:${{ common: '#bbb', uncommon: '#6fd16f', rare: '#4fa8ff', epic: '#b36bff', legendary: '#ffb13a' }[it.rarity]}">(${it.rarity})</span>` : pickupText({ type: it.type, data: it.data })}`;
  const b = nearBoard(); if (b) return `<b>[F]</b> Aceitar contrato: ${b.name}`;
  if (nearStation()) return '<b>[B]</b> Estação de compra';
  void y; return null;
}
function idleCamera(t) { world.camera.position.set(Math.cos(t / 12) * 170, 70, Math.sin(t / 12) * 170); world.camera.lookAt(0, 0, 0); world.update(0.016, null, world.camera.position, t); }
frame();

// Tab = placar do squad
addEventListener('keydown', e => { if (e.code === 'Tab' && G.snap) hud.scoreboard(true, [{ name: G.name, kills: G.snap.you.stats.kills, state: G.snap.you.s }, ...G.snap.squad.map(m => ({ name: m.name, kills: '-', state: m.state }))]); });
addEventListener('keyup', e => { if (e.code === 'Tab') hud.scoreboard(false); });
window.ZR = G; // depuração
