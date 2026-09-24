import * as THREE from 'three';
import { C2S } from '../../shared/protocol.js';
import { MapGeometry } from '../../shared/geometry.js';
import { Prediction } from './Prediction.js';
import { Interpolation } from './Interpolation.js';
import { Avatars } from '../render/Avatars.js';
import { ViewModel } from '../render/ViewModel.js';
import { Effects } from '../render/Effects.js';
import { characters } from '../render/characters/CharacterFactory.js';
import { assets } from '../assets/AssetManager.js';
import { settings } from '../core/Settings.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 30;
const AUTO = new Set(['rifle', 'smg']);
const ACTION_OPTS = { reload: { slow: 0.8 }, plate: { slow: 0.6, blocksAds: true }, heal: {}, revive: { slow: 0, blocksAds: true } };
const EYE = { stand: 1.6, crouch: 1.1, prone: 0.45 };
const RAR_COLOR = { common: '#bbb', uncommon: '#6fd16f', rare: '#4fa8ff', epic: '#b36bff', legendary: '#ffb13a' };

/**
 * GameSession — uma partida do ponto de vista do cliente (online ou offline).
 * Só apresentação + predição do próprio movimento; toda decisão vem do servidor.
 */
export class GameSession {
  constructor(app, net, meta) {
    this.app = app; this.net = net; this.meta = meta;
    const { world } = app;
    this.world = world; this.hud = app.hud; this.audio = app.audio; this.input = app.input;
    this.avatars = new Avatars(world.scene); this.effects = new Effects(world.scene); this.vm = new ViewModel(world.camera);
    this.self = null;   // próprio operador em 3ª pessoa (criado quando os modelos estiverem prontos)
    Object.assign(this, { id: null, cfg: null, mapView: null, geo: null, pred: null, interp: null, snap: null, inMatch: false, ended: false,
      boards: new Map(), stations: [], seq: 0, acc: 0, nextFire: 0, shotsSinceSnap: 0, shopOpen: false, hurtT: 0, shake: 0, waitingAssets: false });
    this.offs = [];
    const on = (t, fn) => net.on(t, fn);
    on('welcome', m => this.onWelcome(m));
    on('lobby', l => this.onLobby(l));
    on('matchStart', p => this.onMatchStart(p));
    on('snap', s => this.onSnap(s));
    on('ev', e => this.onEvent(e));
    on('status', st => { if (!this.inMatch) return; if (st === 'offline') this.hud.announce('CONEXÃO PERDIDA — RECONECTANDO…', 99); else this.hud.announce('', 0); });
    on('error', e => { this.hud.notify(`Servidor: ${e}`, 4); if (this.meta.mode === 'online') this.app.menu.setOnlineStatus(`Servidor: ${e}`); });
    this.onAction = a => this.action(a);
    this.onSwap = () => { const inv = this.snap?.you.inv; if (inv) this.net.send(C2S.SWITCH, { slot: inv.active === 'primary' ? 'secondary' : 'primary' }); };
    this.onFireDown = () => this.tryFire(true);
    this.input.on('action', this.onAction); this.input.on('swap', this.onSwap); this.input.on('fireDown', this.onFireDown);
    this.shopClick = e => { const it = e.target.closest('[data-item]'); if (it) this.net.send(C2S.BUY, { stationId: $('shop').dataset.station, item: it.dataset.item, targetId: it.dataset.target }); };
    $('shop').addEventListener('click', this.shopClick);
    this.keyTab = e => { if (e.code !== 'Tab' || !this.snap) return; this.hud.scoreboard(e.type === 'keydown', [{ name: this.myName, kills: this.snap.you.stats.kills, state: this.snap.you.s }, ...this.snap.squad.map(m => ({ name: m.name, kills: '-', state: m.state }))]); };
    addEventListener('keydown', this.keyTab); addEventListener('keyup', this.keyTab);
    window.ZR = this;
  }
  get myName() { return settings.get('name') || 'Jogador'; }
  wantsCursor() { return this.shopOpen || this.ended; }
  requestLock() { if (this.inMatch && !this.wantsCursor()) this.app.canvas.requestPointerLock?.(); }

  // ------------------------------------------------------------ rede
  onWelcome(m) {
    this.id = m.id; if (m.config) this.cfg = m.config;
    if (m.map) { this.mapView = m.map; this.geo = MapGeometry.fromView(m.map); this.world.buildMap(m.map, this.geo); this.avatars.setGeo(this.geo); }
    this.pred = new Prediction(this.cfg, this.geo); this.interp = new Interpolation(this.cfg.network.interpolationDelay);
    if (m.reconnected) this.hud.notify('RECONECTADO À PARTIDA', 3);
    // offline: congela a simulação até os modelos 3D chegarem (a partida espera por você)
    if (this.meta.mode === 'offline' && !assets.done) {
      this.waitingAssets = true; this.net.pause(true);
      const tick = () => this.app.setLoading(`Carregando modelos 3D… ${Math.round(assets.progress * 100)}%`, 0.15 + assets.progress * 0.8);
      assets.addEventListener('progress', tick); tick();
      assets.wait().then(() => { assets.removeEventListener('progress', tick); this.waitingAssets = false; this.net.pause(false); this.app.setLoading('Entrando na aeronave…', 0.97); });
    } else this.app.setLoading('Entrando na aeronave…', 0.9);
  }
  onLobby(l) {
    if (this.inMatch) return;
    if (this.meta.mode === 'online') { this.app.menu.show(true); this.app.menu.go('online'); this.app.menu.lobby(l, this.id); }
  }
  onMatchStart(p) {
    this.inMatch = true; this.ended = false;
    this.app.menu.show(false); this.app.showLoading(false); this.hud.show(true); $('end').classList.add('hidden');
    this.world.startMatch(p); this.avatars.clear();
    if (this.self) { this.world.scene.remove(this.self.root, this.self.weapon); }
    this.self = characters.create({ operator: settings.get('operator') }); this.world.scene.add(this.self.root, this.self.weapon); this.self.root.visible = false;
    this.boards = new Map((p.boards ?? []).map(b => [b.id, b])); this.stations = p.stations ?? [];
    this.input.enabled = true; this.input.resetToggles();
    this.hud.announce('A AERONAVE DECOLOU', 3); this.audio.warn();
    this.requestLock();
  }
  onSnap(s) {
    const prev = this.snap?.you.s;
    this.snap = s; this.shotsSinceSnap = 0;
    this.interp.push(s.time, s.others);
    this.pred.reconcile(s.you, this.net.serverNow());
    if (s.you.s !== prev) this.onStateChange(prev, s.you.s);
  }
  onStateChange(from, to) {
    const h = this.hud;
    if (to === 'freefall' && from === 'awaiting') { h.announce('DE VOLTA À AÇÃO!', 2.5); this.audio.warn(); }
    if (to === 'freefall' && from === 'aircraft') h.announce('SALTOU!', 1.5);
    if (to === 'awaiting') h.announce('ELIMINADO — AGUARDANDO RETORNO', 3);
    if (to === 'eliminated') h.announce('VOCÊ FOI ELIMINADO', 3);
    if (to === 'downed') h.announce('VOCÊ FOI ABATIDO', 2);
    if (['freefall', 'aircraft'].includes(to) && this.snap) this.input.yaw = this.snap.you.yaw ?? this.input.yaw;
  }
  nameOf(id) { if (id === this.id) return this.myName; return this.snap?.others.find(o => o.id === id)?.n ?? this.snap?.squad.find(m => m.id === id)?.name ?? '?'; }
  isAlly(id) { return this.snap?.squad.some(m => m.id === id); }

  onEvent(e) {
    const me = this.id, h = this.hud, a = this.audio;
    switch (e.type) {
      case 'lootSpawned': this.world.addLoot(e.item); break;
      case 'lootRemoved': this.world.removeLoot(e.id); break;
      case 'contractBoard': { const b = this.boards.get(e.id); if (b) b.taken = e.taken; this.world.setBoard(e.id, e.taken); break; }
      case 'killfeed': this.avatars.kill(e.victimId); h.killfeed(`${e.attacker ?? '☣ zona'} ✖ ${e.victim}`, e.attackerId === me || e.victimId === me || this.isAlly(e.victimId)); if (e.attackerId === me) { h.hitmarker(false, true); a.kill(); h.xp('+100 ELIMINAÇÃO'); } break;
      case 'damage':
        if (e.attackerId === me) { h.hitmarker(e.part === 'head', false); a.hit(e.part === 'head'); if (e.armorBroken) a.crack(); }
        if (e.victimId === me) { this.hurtT = performance.now(); if (e.fromX !== undefined && e.source !== 'zone') h.damageFrom(Math.atan2(e.fromX - this.pred.body.pos.x, -(e.fromZ - this.pred.body.pos.z))); }
        break;
      case 'downed': if (e.attackerId === me) h.notify(`${this.nameOf(e.victimId)} ABATIDO`, 1.5); else if (this.isAlly(e.victimId)) h.notify(`${this.nameOf(e.victimId)} FOI ABATIDO — reviva!`, 3); break;
      case 'revived': if (e.playerId === me) h.announce('REVIVIDO!', 2); else if (e.reviverId === me) { h.notify('ALIADO REVIVIDO', 2); h.xp('+75 REVIVER'); } break;
      case 'respawned': if (this.isAlly(e.playerId)) h.notify(`${this.nameOf(e.playerId)} RETORNOU`, 2.5); break;
      case 'resurgenceDisabled': h.announce('RESSURGIMENTO DESATIVADO', 4); h.notify('Mortes agora são definitivas', 4); a.warn(); break;
      case 'zonePhase': h.notify(`FASE ${e.phase + 1}/${e.total}: nova zona marcada`, 3); break;
      case 'zoneClosing': h.announce('A ZONA ESTÁ FECHANDO', 2.5); a.warn(); break;
      case 'squadEliminated': if (this.snap?.you.squad === e.squadId) h.announce(`SQUAD ELIMINADO — #${e.placement}`, 5); break;
      case 'shot': {
        if (e.playerId === me) break;
        this.avatars.fire(e.playerId);
        a.shot(e.weapon, e);
        const d = { x: -Math.sin(e.yaw) * Math.cos(e.pitch), y: Math.sin(e.pitch), z: -Math.cos(e.yaw) * Math.cos(e.pitch) };
        const end = e.hit ?? { x: e.x + d.x * 60, y: e.y + d.y * 60, z: e.z + d.z * 60 };
        this.effects.tracer({ x: e.x + d.x, y: e.y - 0.1, z: e.z + d.z }, end);
        if (e.hit) this.effects.spark(new THREE.Vector3(e.hit.x, e.hit.y, e.hit.z), 0xaa2222);
        if (!this.isAlly(e.playerId)) h.shotPing(e.x, e.z);
        break;
      }
      case 'explosion': { this.effects.explosion(e, e.radius); a.explosion(e); const d = Math.hypot(e.x - this.pred.body.pos.x, e.z - this.pred.body.pos.z); if (d < 35) this.shake = Math.max(this.shake, 0.7 * (1 - d / 35)); break; }
      case 'pickup': if (e.playerId === me) { if (e.kind === 'cash') a.cash(); else a.ui(); if (!e.auto) h.notify(this.pickupText(e.kind, e.data), 1.5); } break;
      case 'pickupFailed': if (e.playerId === me && e.reason !== 'gone') h.notify({ full: 'Inventário cheio', range: 'Muito longe', state: 'Agora não' }[e.reason] ?? e.reason, 1.5); break;
      case 'purchase': h.notify(e.playerId === me ? `COMPRADO: ${e.name}` : `${this.nameOf(e.playerId)} comprou ${e.name}`, 2.5); a.cash(); if (e.playerId === me) this.renderShop(); break;
      case 'purchaseFailed': if (e.playerId === me) { h.notify(`Compra: ${e.reason}`, 2); a.warn(); } break;
      case 'contractStarted': h.announce(`CONTRATO: ${e.contract.name.toUpperCase()}`, 3); a.ui(); break;
      case 'contractUpdate': a.ui(); break;
      case 'contractCompleted': h.announce(`CONTRATO CONCLUÍDO · +$${e.reward.cash} · +${e.reward.xp} XP`, 3.5); a.cash(); break;
      case 'contractFailed': if (!e.start || e.playerId === me) h.notify(`Contrato: ${e.reason}`, 2.5); break;
      case 'plateBroken': if (e.attackerId === me) a.crack(); break;
      case 'chestOpened': this.world.setChestOpened(e.chestId); if (e.playerId === me) { a.cash(); h.notify('BAÚ ABERTO', 1.2); } break;
      case 'matchEnded':
        this.inMatch = false; this.ended = true; this.input.enabled = false;
        if (document.pointerLockElement) document.exitPointerLock();
        this.app.showEnd(e, me);
        break;
    }
  }
  pickupText(kind, data) {
    if (kind === 'weapon') return `Pegou ${this.cfg.weapons[data.id]?.name}`;
    return { ammo: `+${data.amount} munição`, plate: `+${data.amount} placa(s)`, cash: `+$${data.amount}`, heal: '+1 cura', lethal: '+1 granada', intel: 'Inteligência coletada' }[kind] ?? kind;
  }
  waitNextMatch() { this.ended = false; this.app.menu.show(true); this.app.menu.go('online'); this.app.menu.setOnlineStatus('Aguardando a próxima partida…'); }

  // ------------------------------------------------------------ ações
  action(a) {
    if (!this.inMatch || !this.snap) return;
    const n = this.net, i = this.input;
    switch (a) {
      case 'reload': n.send(C2S.RELOAD); break;
      case 'primary': n.send(C2S.SWITCH, { slot: 'primary' }); break;
      case 'secondary': n.send(C2S.SWITCH, { slot: 'secondary' }); break;
      case 'plate': n.send(C2S.USE_PLATE); break;
      case 'heal': n.send(C2S.USE_HEAL); break;
      case 'lethal': n.send(C2S.THROW, { yaw: i.yaw, pitch: i.pitch }); break;
      case 'tactical': n.send(C2S.TACTICAL, { yaw: i.yaw, pitch: i.pitch }); break;
      case 'melee': n.send(C2S.MELEE, { yaw: i.yaw }); break;
      case 'interact': { const c = this.nearestChest(), it = this.nearestLoot(); if (c && (!it || c.d < it.d)) n.send(C2S.CHEST, { chestId: c.id }); else if (it) n.send(C2S.PICKUP, { lootId: it.id }); break; }
      case 'contract': { const b = this.nearBoard(); if (b) n.send(C2S.CONTRACT, { boardId: b.id }); else this.hud.notify('Nenhum tablet de contrato por perto', 1.5); break; }
      case 'shop': this.toggleShop(); break;
      case 'map': $('bigmap').classList.toggle('hidden'); break;
      case 'specNext': n.send(C2S.SPECTATE, { dir: 1 }); break;
      case 'specPrev': n.send(C2S.SPECTATE, { dir: -1 }); break;
    }
  }
  nearestLoot() {
    const p = this.pred.body.pos; let best = null, bd = this.cfg.loot.pickupRange;
    for (const m of this.world.loot.values()) { const it = m.userData.item; if (it.type === 'intel' && !this.snap.you.contract) continue; if (Math.abs(it.y - p.y) > 1.8) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = { ...it, d }; } }
    return best;
  }
  nearestChest() {
    const p = this.pred.body.pos; let best = null, bd = this.cfg.loot.chestRange ?? 2.4;
    for (const k of this.world.chestMeshes?.values() ?? []) { const c = k.userData.item; if (c.opened || Math.abs(c.y - p.y) > 1.8) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; best = { ...c, d }; } }
    return best;
  }
  nearBoard() { const p = this.pred.body.pos; return [...this.boards.values()].find(b => !b.taken && Math.hypot(b.x - p.x, b.z - p.z) < this.cfg.contracts.interactRange); }
  nearStation() { const p = this.pred.body.pos; return this.stations.find(s => Math.hypot(s.x - p.x, s.z - p.z) < this.cfg.stations.interactRange); }
  toggleShop(force) {
    const st = this.nearStation();
    this.shopOpen = force ?? (!this.shopOpen && !!st);
    if (!st && force === undefined && !this.shopOpen) this.hud.notify('Aproxime-se de uma estação de compra', 1.5);
    if (this.shopOpen) document.exitPointerLock?.(); else if (force === undefined) this.requestLock();
    this.renderShop();
  }
  renderShop() { const st = this.nearStation(); if (!st) this.shopOpen = false; this.hud.shop(this.shopOpen, st, this.cfg, this.snap?.you.inv?.cash ?? 0, this.snap?.squad ?? []); }

  tryFire(click) {
    const y = this.snap?.you; if (!y || y.s !== 'alive' || !y.inv || this.shopOpen || !this.input.enabled) return;
    const w = y.inv[y.inv.active]; if (!w) return;
    const def = this.cfg.weapons[w.id], now = performance.now() / 1000;
    if (!click && !AUTO.has(w.id)) return;
    if (now < this.nextFire || y.action?.type === 'plate' || y.action?.type === 'revive') return;
    if (w.mag - this.shotsSinceSnap <= 0) { if (click) { this.audio.tone(220, 0.04, 0.05); this.net.send(C2S.RELOAD); } return; }
    this.nextFire = now + 60 / def.rpm; this.shotsSinceSnap++;
    this.net.send(C2S.FIRE, { yaw: this.input.yaw, pitch: this.input.pitch });
    this.vm.fire(def.recoil); this.audio.shot(w.id, null, true);
    const cam = this.world.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const wall = this.geo.raycast(o, d, def.range), end = o.clone().addScaledVector(d, wall ?? def.range);
    this.effects.tracer(o.clone().addScaledVector(d, 1.2).add(new THREE.Vector3(0, -0.12, 0)), end); if (wall) this.effects.spark(end);
    this.input.pitch = Math.min(1.5, this.input.pitch + def.recoil * 0.008 * (y.ads ? 0.6 : 1)); this.input.yaw += (Math.random() - 0.5) * def.recoil * 0.004;
  }

  // ------------------------------------------------------------ frame
  frame(dt, time) {
    const { world, input, hud } = this;
    if (!this.snap || !this.pred || !this.inMatch) { this.idleCamera(time); world.render(); return; }
    const y = this.snap.you, serverNow = this.net.serverNow();
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const inp = input.sample(++this.seq, STEP);
      if (this.shopOpen || !input.enabled) Object.assign(inp, { mx: 0, mz: 0, jump: false, sprint: false });
      this.net.send(C2S.INPUT, inp);
      this.pred.step(inp, STEP, serverNow, ACTION_OPTS[y.action?.type] ?? {});
    }
    if (input.fire) this.tryFire(false);

    const others = this.interp.sample(serverNow);
    this.avatars.update(others, dt, this.world.camera.position);
    const pos = this.pred.renderPos(this.acc / STEP, dt), body = this.pred.body;
    const inv = y.inv, w = inv?.[inv.active];

    // câmera
    const cam = world.camera, st = y.s;
    let third = false, target = pos, tyaw = input.yaw, tpitch = input.pitch;
    if (st === 'aircraft') { third = true; target = { x: y.x, y: y.y, z: y.z }; }
    else if (st === 'freefall' || st === 'parachute') third = true;
    else if (st === 'awaiting' || st === 'eliminated') {
      const sp = others.find(o => o.id === y.spectating);
      if (sp) { third = true; target = sp; tyaw = sp.yaw; tpitch = -0.25; } else target = { x: this.snap.zone.x, y: 0, z: this.snap.zone.z };
    }
    if (third) {
      const dist = st === 'aircraft' ? 28 : st === 'freefall' ? 7 : st === 'parachute' ? 9 : 5, hgt = st === 'aircraft' ? 8 : 2.5;
      cam.position.set(target.x + Math.sin(tyaw) * dist * Math.cos(tpitch), target.y + hgt - Math.sin(tpitch) * dist, target.z + Math.cos(tyaw) * dist * Math.cos(tpitch));
      cam.lookAt(target.x, target.y + 1.5, target.z);
    } else if (st === 'awaiting' || st === 'eliminated') {
      cam.position.set(target.x + Math.cos(time * 0.1) * 120, 120, target.z + Math.sin(time * 0.1) * 120); cam.lookAt(target.x, 0, target.z);
    } else {
      const eye = st === 'downed' ? 0.5 : body.slide ? 0.9 : EYE[body.stance] ?? 1.6;
      cam.position.set(pos.x, pos.y + eye, pos.z); cam.rotation.set(input.pitch, input.yaw, 0, 'YXZ');
    }
    if (window.DEBUG_CAM) { const d = window.DEBUG_CAM; cam.position.set(d.x, d.y, d.z); cam.rotation.set(d.pitch ?? 0, d.yaw ?? 0, 0, 'YXZ'); }   // câmera livre de depuração
    if (this.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 1.5); }
    const sniper = y.ads && w?.id === 'marksman' && st === 'alive';
    const baseFov = settings.get('fov');
    const fov = st === 'alive' ? (y.ads ? (sniper ? 22 : baseFov * 0.72) : body.sprinting ? baseFov + 7 : baseFov) : baseFov;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();
    input.zoomScale = sniper ? 0.35 : 1;

    if (this.self) {
      const show = ['freefall', 'parachute'].includes(st);
      this.self.root.visible = show; this.self.weapon.visible = false;
      if (show) this.self.animator.update(dt, { x: pos.x, y: pos.y, z: pos.z, yaw: input.yaw, pitch: 0, vx: body.vel.x, vz: body.vel.z, state: st, stance: 'stand', grounded: false, weapon: null });
    }

    this.vm.setWeapon(st === 'alive' ? w?.id ?? null : null);
    this.vm.update(dt, { ads: y.ads, sprint: body.sprinting, moving: Math.hypot(body.vel.x, body.vel.z) > 1 && body.grounded, action: y.action?.type, visible: st === 'alive', sniperScope: sniper });

    this.audio.listener(cam.position, input.yaw); this.audio.setWind(st === 'freefall' || st === 'parachute', st === 'freefall' ? 1.4 : 0.6);

    const u = world.grade.uniforms, hurt = Math.max(0, 1 - (performance.now() - this.hurtT) / 600);
    u.damage.value = Math.min(1, Math.max(hurt * 0.8, (100 - y.hp) / 120));
    u.gas.value += ((y.zone.outside > 0 && !['awaiting', 'eliminated', 'aircraft'].includes(st) ? 1 : 0) - u.gas.value) * Math.min(1, dt * 4);
    u.ads.value += ((y.ads ? 1 : 0) - u.ads.value) * Math.min(1, dt * 8); u.downed.value = st === 'downed' ? 1 : 0;

    const def = w && this.cfg.weapons[w.id];
    hud.update({ snap: this.snap, cfg: this.cfg, yaw: input.yaw, pos, mapView: this.mapView, geo: this.geo, stations: this.stations, boards: this.boards, others, myName: this.myName,
      prompt: st === 'alive' ? this.promptText() : null,
      spectatingName: y.spectating && (others.find(o => o.id === y.spectating)?.n), hideCrosshair: y.ads || body.sprinting || st !== 'alive',
      spread: def ? (def.spreadHip * 400 + 4) * (Math.hypot(body.vel.x, body.vel.z) > 1 ? 1.5 : 1) : 6, sniperScope: sniper,
      netText: this.meta.mode === 'offline' ? `offline · ${this.meta.label}` : `ping ${Math.round(this.net.rtt * 1000)} ms · correções ${this.pred.corrections}` });
    if (this.shopOpen && !this.nearStation()) this.toggleShop(false);

    world.update(dt, this.snap, cam.position, time);
    this.effects.update(dt);
    world.render();
  }
  promptText() {
    const p = this.pred.body.pos;
    const ally = this.snap.others.find(o => o.a && o.s === 'downed' && Math.hypot(o.x - p.x, o.z - p.z) <= this.cfg.downed.reviveRange);
    if (ally) return `<b>[Segure E]</b> Reviver ${ally.n}`;
    const ch = this.nearestChest(); if (ch && this.snap.you.action?.type !== 'chest') return '<b>[E]</b> Abrir baú de suprimentos';
    const it = this.nearestLoot();
    if (it) return `<b>[E]</b> ${it.type === 'weapon' ? `${this.cfg.weapons[it.data.id]?.name} <span style="color:${RAR_COLOR[it.rarity]}">(${it.rarity})</span>` : this.pickupText(it.type, it.data)}`;
    const b = this.nearBoard(); if (b) return `<b>[F]</b> Aceitar contrato: ${b.name}`;
    if (this.nearStation()) return '<b>[B]</b> Estação de compra';
    return null;
  }
  idleCamera(t) { const c = this.world.camera; c.position.set(Math.cos(t / 12) * 170, 70, Math.sin(t / 12) * 170); c.lookAt(0, 0, 0); this.world.update(0.016, null, c.position, t); }

  dispose() {
    this.net.close();
    this.input.removeEventListener('action', this.onAction);
    removeEventListener('keydown', this.keyTab); removeEventListener('keyup', this.keyTab);
    $('shop').removeEventListener('click', this.shopClick); $('shop').classList.add('hidden'); $('bigmap').classList.add('hidden');
    this.avatars.clear(); if (this.self) this.world.scene.remove(this.self.root, this.self.weapon); this.vm.root.parent?.remove(this.vm.root);
    this.world.clearMatch?.();
  }
}
