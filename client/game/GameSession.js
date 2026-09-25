import * as THREE from 'three';
import { C2S } from '../../shared/protocol.js';
import { MapGeometry } from '../../shared/geometry.js';
import { weaponWeight } from '../../shared/movement.js';
import { KEYMAP, keyName } from './InputSystem.js';
import { UI_URL } from '../ui/HUDSystem.js';
const keyHint = action => { const k = [].concat(KEYMAP[action] ?? [])[0]; return k ? `<kbd>${keyName(k)}</kbd>` : ''; };
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
/** Semente do padrão de recuo por arma (determinística pelo id). */
const patternSeed = id => [...(id ?? '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) / 97;
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
    this.input.on('action', this.onAction); this.onRelease = a => { if (a === 'melee') this.onMeleeRelease(); }; this.input.on('release', this.onRelease); this.input.on('swap', this.onSwap); this.input.on('fireDown', this.onFireDown);
    this.shopClick = e => { const it = e.target.closest('[data-item]'); if (it) this.net.send(C2S.BUY, { stationId: $('shop').dataset.station, item: it.dataset.item, targetId: it.dataset.target }); };
    $('shop').addEventListener('click', this.shopClick);
    this.keyTab = e => {
      if (e.code !== 'Tab' || !this.snap) return; const y = this.snap.you;
      if (y.inv) this.hud.inventory(e.type === 'keydown', { inv: y.inv, cfg: this.cfg, squad: this.snap.squad, you: y, rarColor: RAR_COLOR });
      else this.hud.scoreboard(e.type === 'keydown', [{ name: this.myName, kills: y.stats.kills, state: y.s }, ...this.snap.squad.map(m => ({ name: m.name, kills: '-', state: m.state }))]);
    };
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
    this.mstats = { killsByClass: {}, kills: 0, revives: 0, chests: 0, contracts: 0, damage: 0 };   // para os desafios
    this.app.menu.show(false); this.app.showLoading(false); this.hud.show(true); $('end').classList.add('hidden');
    this.world.startMatch(p); this.avatars.clear();
    if (this.self) { this.world.scene.remove(this.self.root, this.self.weapon); }
    this.self = characters.create({ operator: settings.get('operator') }); this.world.scene.add(this.self.root, this.self.weapon); this.self.root.visible = false;
    { const ch = this.avatars.chuteModel(); if (ch) { ch.visible = false; this.self.root.add(ch); this.self.chute = ch; } }
    this.warmup();
    this.boards = new Map((p.boards ?? []).map(b => [b.id, b])); this.stations = p.stations ?? [];
    this.input.enabled = true; this.input.resetToggles();
    this.hud.announce('A AERONAVE DECOLOU', 3); this.audio.warn();
    this.requestLock();
  }
  /**
   * Pré-aquecimento: compila na GPU os shaders de tudo que vai aparecer (operadores de
   * todas as cores, cada arma, loot, fumaça) antes de jogar — sem isso cada coisa nova
   * que entra na tela pela 1ª vez trava o jogo por dezenas de ms.
   */
  warmup() {
    const w = this.world, tmp = new THREE.Group(), made = [];
    for (let op = 0; op < 4; op++) {
      const c = characters.create({ operator: op }); c.setWeapon(['rifle', 'smg', 'battle', 'sniper'][op]);
      c.root.position.set(op * 2, -500, 0); c.weapon.position.set(op * 2, -500, 0); tmp.add(c.root, c.weapon); made.push(c);
    }
    for (const id of Object.keys(this.cfg?.weapons ?? {})) { const g = characters.gun(id); g.position.y = -500; tmp.add(g); }
    this.effects.smoke({ x: 0, y: -500, z: 0 }, 1, 0.01);
    this.effects.explosion({ x: 0, y: -500, z: 0 }, 1); this.effects.tracer(new THREE.Vector3(0, -500, 0), new THREE.Vector3(1, -500, 0)); this.effects.spark(new THREE.Vector3(0, -500, 0));
    w.lootR.prewarm(Object.keys(this.cfg?.weapons ?? {}));
    for (const k of w.lootR.kinds.values()) { k.mesh.count = 1; k.mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -500, 0)); }
    this.vm.setWeapon('rifle');
    w.scene.add(tmp);
    try { w.renderer.compile(w.scene, w.camera); } catch (e) { console.warn('warmup', e); }
    w.scene.remove(tmp); this.vm.setWeapon(null);
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
      case 'killfeed': this.avatars.kill(e.victimId); h.killfeed(`${e.attacker ?? '☣ zona'} ✖ ${e.victim}`, e.attackerId === me || e.victimId === me || this.isAlly(e.victimId)); if (e.attackerId === me) { const wid = this.snap?.you.inv?.[this.snap.you.inv.active]?.id, cl = this.cfg.weapons[wid]?.class ?? 'ar'; this.mstats.kills++; this.mstats.killsByClass[cl] = (this.mstats.killsByClass[cl] ?? 0) + 1; h.hitmarker(false, true); a.kill(); h.xp('+100 ELIMINAÇÃO'); h.killBanner(e.victim, { head: e.part === 'head' || e.headshot, finisher: e.cause === 'finished' }); } break;
      case 'damage':
        if (e.attackerId === me) {
          this.mstats.damage += e.amount ?? 0;
          h.hitmarker(e.part === 'head', false); a.hit(e.part === 'head'); if (e.armorBroken) a.crack();
          const v = this.interp.latest?.(e.victimId) ?? this.snap?.others.find(o => o.id === e.victimId);
          if (v && settings.get('damageNumbers') !== false) { const pr = new THREE.Vector3(v.x, v.y + 1.9, v.z).project(this.world.camera); if (pr.z < 1) h.damageNumber((pr.x * 0.5 + 0.5) * innerWidth, (-pr.y * 0.5 + 0.5) * innerHeight, e.amount, e.part === 'head' ? 'head' : e.armorHit ? 'armor' : ''); }
        }
        if (e.victimId === me) { this.hurtT = performance.now(); if (e.fromX !== undefined && e.source !== 'zone') h.damageFrom(Math.atan2(e.fromX - this.pred.body.pos.x, -(e.fromZ - this.pred.body.pos.z))); }
        break;
      case 'downed': if (e.attackerId === me) h.notify(`${this.nameOf(e.victimId)} ABATIDO`, 1.5); else if (this.isAlly(e.victimId)) h.notify(`${this.nameOf(e.victimId)} FOI ABATIDO — reviva!`, 3); break;
      case 'revived': if (e.playerId === me) h.announce('REVIVIDO!', 2); else if (e.reviverId === me) { this.mstats.revives++; h.notify('ALIADO REVIVIDO', 2); h.xp('+75 REVIVER'); } break;
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
      case 'contractStarted': h.banner(`CONTRATO ACEITO · ${e.contract.name.toUpperCase()}`, { hunt: '⌖', scavenger: '⚲', capture: '⚑', survive: '⛨', intel: '✉' }[e.contract.type] ?? '◆'); a.ui(); break;
      case 'contractUpdate': a.ui(); break;
      case 'contractCompleted': this.mstats.contracts++; h.announce(`CONTRATO CONCLUÍDO · +$${e.reward.cash} · +${e.reward.xp} XP`, 3.5); a.cash(); break;
      case 'contractFailed': if (!e.start || e.playerId === me) h.notify(`Contrato: ${e.reason}`, 2.5); break;
      case 'smoke': this.effects.smoke(e, e.radius, e.duration); a.smokePop(e); break;
      case 'melee': if (e.playerId !== me) a.whoosh(e); break;
      case 'meleeHit': if (e.attackerId === me) { a.stab(); h.hitmarker(false, e.finisher); if (e.finisher) h.xp('+150 FINALIZAÇÃO'); } break;
      case 'ping': this.pings = (this.pings ?? []).filter(p => p.by !== e.playerId); this.pings.push({ ...e, by: e.playerId, until: performance.now() + (e.kind === 'enemy' ? 5000 : 9000) }); a.ping(e.kind); if (e.playerId !== me) h.notify(`${e.name}: ${{ enemy: 'INIMIGO AVISTADO', loot: 'ITEM AQUI', go: 'VAMOS PARA LÁ' }[e.kind]}`, 2); break;
      case 'plateBroken': if (e.attackerId === me) a.crack(); break;
      case 'chestOpened': this.world.setChestOpened(e.chestId); if (e.playerId === me) { this.mstats.chests++; a.cash(); h.notify('BAÚ ABERTO', 1.2); } break;
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
      case 'knife': n.send(C2S.SWITCH, { slot: 'knife' }); break;
      case 'melee':   // V: toque = golpe rápido; segurar (settings.knifeHold s) = equipa a faca
        this.meleeHeldAt = performance.now(); this.meleeEquipped = false; break;
      case 'ping': this.sendPing(); break;
      case 'interact': { const c = this.nearestChest(), it = this.nearestLoot(); if (c && (!it || c.d < it.d)) n.send(C2S.CHEST, { chestId: c.id }); else if (it) n.send(C2S.PICKUP, { lootId: it.id }); break; }
      case 'contract': { const b = this.nearBoard(); if (b) n.send(C2S.CONTRACT, { boardId: b.id }); else this.hud.notify('Nenhum tablet de contrato por perto', 1.5); break; }
      case 'shop': this.toggleShop(); break;
      case 'map': $('bigmap').classList.toggle('hidden'); break;
      case 'specNext': n.send(C2S.SPECTATE, { dir: 1 }); break;
      case 'specPrev': n.send(C2S.SPECTATE, { dir: -1 }); break;
    }
  }
  /**
   * Balanço da luneta (sniper/DMR mirando): a mira "respira" em figura de oito.
   * Shift segura a respiração (quase para) por até 5 s; depois treme até soltar e recuperar.
   */
  updateSway(dt, scoped) {
    const S = this.sway ??= { y: 0, p: 0, t: 0, breath: 5, hold: false, k: 0 };
    S.k += ((scoped ? 1 : 0) - S.k) * Math.min(1, dt * 6);
    const holding = scoped && this.input.down('sprint') && S.breath > 0;
    if (holding) S.breath = Math.max(0, S.breath - dt); else if (!this.input.down('sprint')) S.breath = Math.min(5, S.breath + dt * 1.2);
    const exhausted = scoped && this.input.down('sprint') && S.breath <= 0;
    S.hold = holding; S.t += dt;
    const amp = 0.011 * S.k * (holding ? 0.07 : exhausted ? 1.8 : 1) * (this.pred.body.stance === 'prone' ? 0.45 : this.pred.body.stance === 'crouch' ? 0.75 : 1);
    const ty = (Math.sin(S.t * 0.9) + Math.sin(S.t * 2.3 + 1.2) * 0.35) * amp, tp = (Math.sin(S.t * 1.8 + 0.6) * 0.6 + Math.sin(S.t * 3.1) * 0.2) * amp;
    const f = Math.min(1, dt * (holding ? 3 : 6)); S.y += (ty - S.y) * f; S.p += (tp - S.p) * f;
  }
  /** Soltou o V: se foi um toque, golpe rápido (a arma continua na mão). */
  onMeleeRelease() {
    if (this.meleeHeldAt == null || !this.inMatch) return;
    const held = (performance.now() - this.meleeHeldAt) / 1000; this.meleeHeldAt = null;
    if (!this.meleeEquipped && held < (settings.get('knifeHold') ?? 3)) { this.net.send(C2S.MELEE, { yaw: this.input.yaw }); this.vm.melee(); this.audio.whoosh(); }
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
    if (y.inv.active === 'knife') {   // faca na mão: clique = golpe (o servidor valida a recarga do golpe)
      const now = performance.now() / 1000; if (!click || now < (this.knifeAt ?? 0)) return;
      this.knifeAt = now + (this.cfg.equipment?.melee?.cooldown ?? 0.8); this.net.send(C2S.MELEE, { yaw: this.input.yaw }); this.vm.melee(); this.audio.whoosh(); return;
    }
    const w = y.inv[y.inv.active]; if (!w) return;
    const def = this.cfg.weapons[w.id], now = performance.now() / 1000;
    if (!click && !def.auto) return;
    if (now < this.nextFire || y.action?.type === 'plate' || y.action?.type === 'revive') return;
    if (w.mag - this.shotsSinceSnap <= 0) { if (click) { this.audio.tone(220, 0.04, 0.05); this.net.send(C2S.RELOAD); } return; }
    this.nextFire = now + 60 / def.rpm; this.shotsSinceSnap++;
    this.net.send(C2S.FIRE, { yaw: this.input.yaw + (this.sway?.y ?? 0), pitch: this.input.pitch + (this.sway?.p ?? 0) });   // o tiro sai para onde a luneta aponta (com o balanço)
    this.vm.fire(def.recoil); this.audio.shot(w.id, null, true); this.hud.fired();
    const cam = this.world.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const wall = this.geo.raycast(o, d, def.range), end = o.clone().addScaledVector(d, wall ?? def.range);
    this.effects.tracer(o.clone().addScaledVector(d, 1.2).add(new THREE.Vector3(0, -0.12, 0)), end); if (wall) this.effects.spark(end);
    // padrão de recuo determinístico por arma (sobe, depois deriva para os lados), escalado pela raridade
    const n = this.recoilShots = (this.recoilShots ?? 0) + 1, rm = (this.cfg.rarity?.[w.rarity]?.recoil ?? 1) * def.recoil * (this.aimNow ? 0.6 : 1) * (y.st === 'crouch' ? 0.8 : y.st === 'prone' ? 0.6 : 1);
    const up = 0.0075 * rm * (1 + Math.min(n, 12) / 12 * 0.6), side = (Math.sin(n * 0.55 + patternSeed(w.id)) * 0.6 + (Math.random() - 0.5) * 0.5) * 0.0035 * rm;
    this.input.pitch = Math.min(1.5, this.input.pitch + up); this.input.yaw += side;
    this.recoilDebt = Math.min(0.2, (this.recoilDebt ?? 0) + up * 0.65); this.camKick = (this.camKick ?? 0) + up * 0.6;
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
      const b0 = this.pred.body, wasG = b0.grounded, vy = b0.vel.y;
      const actIv = y.inv, knifeOn = actIv?.active === 'knife';
      this.pred.step(inp, STEP, serverNow, { ...(ACTION_OPTS[y.action?.type] ?? {}), weight: weaponWeight(this.cfg, actIv?.[actIv.active]?.id, knifeOn) });
      if (!wasG && b0.grounded && vy < -3 && y.s === 'alive') this.onLand(-vy);
    }
    if (!input.fire) this.recoilShots = Math.max(0, (this.recoilShots ?? 0) - dt * 12);
    // recuperação do recuo: devolve parte da subida acumulada quando para de atirar
    if (this.recoilDebt > 0 && !input.fire) { const r = Math.min(this.recoilDebt, dt * 1.6 * Math.max(0.05, this.recoilDebt * 6)); input.pitch -= r; this.recoilDebt -= r; }
    if (input.fire) this.tryFire(false);
    if (this.meleeHeldAt != null && !this.meleeEquipped && (performance.now() - this.meleeHeldAt) / 1000 >= (settings.get('knifeHold') ?? 3)) {
      this.meleeEquipped = true; this.net.send(C2S.SWITCH, { slot: 'knife' }); this.hud.notify('FACA EQUIPADA', 1);
    }

    const others = this.interp.sample(serverNow);
    this.avatars.update(others, dt, this.world.camera.position);
    this.remoteSteps(others, dt);
    if (['alive', 'downed', 'parachute', 'freefall'].includes(y.s)) this.worldMarkers(others); else this.hud.markers([], this.world.camera);
    // estalos da recarga nos pontos da animação (tira / coloca o carregador)
    const ac = y.action;
    if (ac?.type === 'reload' && ac.total) { const k = 1 - ac.left / ac.total; for (const [i, at] of [[0, 0.3], [1, 0.84]]) if (k >= at && !(this.reloadMarks ??= [])[i]) { this.reloadMarks[i] = true; this.audio.reloadClick(i); } }
    else this.reloadMarks = [];
    const pos = this.pred.renderPos(this.acc / STEP, dt), body = this.pred.body;
    const inv = y.inv, w = inv?.[inv.active];

    // câmera
    const cam = world.camera, st = y.s;
    // mira (ADS) prevista no cliente: responde no mesmo quadro do clique, sem esperar o servidor
    const aim = this.aimNow = st === 'alive' && input.aiming && !ACTION_OPTS[y.action?.type]?.blocksAds && !body.slide && !body.mantle && !body.climb;
    let third = false, target = pos, tyaw = input.yaw, tpitch = input.pitch;
    if (st === 'aircraft') { third = true; target = { x: y.x, y: y.y, z: y.z }; }
    else if (st === 'freefall' || st === 'parachute') third = true;
    else if (st === 'awaiting' || st === 'eliminated') {
      const sp = others.find(o => o.id === y.spectating);
      if (sp) { third = true; target = sp; tyaw = sp.yaw; tpitch = -0.25; } else target = { x: this.snap.zone.x, y: 0, z: this.snap.zone.z };
    }
    if (third) {
      const dist = st === 'aircraft' ? 72 : st === 'freefall' ? 7 : st === 'parachute' ? 9 : 5, hgt = st === 'aircraft' ? 16 : 2.5;
      cam.position.set(target.x + Math.sin(tyaw) * dist * Math.cos(tpitch), target.y + hgt - Math.sin(tpitch) * dist, target.z + Math.cos(tyaw) * dist * Math.cos(tpitch));
      cam.lookAt(target.x, target.y + 1.5, target.z);
    } else if (st === 'awaiting' || st === 'eliminated') {
      cam.position.set(target.x + Math.cos(time * 0.1) * 120, 120, target.z + Math.sin(time * 0.1) * 120); cam.lookAt(target.x, 0, target.z);
    } else {
      const eye = st === 'downed' ? 0.5 : body.slide ? 0.9 : EYE[body.stance] ?? 1.6;
      // sensação de câmera: bob do passo, inclinação no strafe/slide, afundada do pouso, tranco do tiro
      const sp = Math.hypot(body.vel.x, body.vel.z), moving = body.grounded && sp > 1 && !body.slide;
      this.bobT = (this.bobT ?? 0) + (moving ? dt * (body.sprinting ? 12.5 : 8.5) : 0);
      const bobA = moving ? Math.min(1, sp / 5) * (aim ? 0.25 : 1) * (body.sprinting ? 0.05 : 0.028) : 0;
      const side = body.vel.x * Math.cos(input.yaw) - body.vel.z * Math.sin(input.yaw);
      this.roll ??= 0; this.roll += ((-side * 0.006 + (body.slide ? 0.06 : 0) + (moving ? Math.sin(this.bobT) * bobA * 0.15 : 0)) - this.roll) * Math.min(1, dt * 8);
      this.landDip = (this.landDip ?? 0) * Math.max(0, 1 - dt * 7); this.camKick = (this.camKick ?? 0) * Math.max(0, 1 - dt * 14);
      this.eyeS = (this.eyeS ?? eye) + (eye - (this.eyeS ?? eye)) * Math.min(1, dt * 12);   // agachar/levantar suave
      cam.position.set(pos.x + Math.cos(input.yaw) * Math.sin(this.bobT * 0.5) * bobA * 0.6, pos.y + this.eyeS - Math.abs(Math.sin(this.bobT)) * bobA - this.landDip, pos.z - Math.sin(input.yaw) * Math.sin(this.bobT * 0.5) * bobA * 0.6);
      this.updateSway(dt, aim && !!this.cfg.weapons[w?.id]?.scope && st === 'alive');
      cam.rotation.set(input.pitch + this.camKick + this.sway.p, input.yaw + this.sway.y, this.roll, 'YXZ');
      // passos locais
      if (moving && body.stance !== 'prone') { this.stepAcc = (this.stepAcc ?? 0) + sp * dt; const stride = body.sprinting ? 2.4 : 1.9; if (this.stepAcc > stride) { this.stepAcc = 0; this.audio.step(null, body.sprinting ? 1 : body.stance === 'crouch' ? 0.3 : 0.6, this.surfaceAt(pos)); } }
    }
    if (window.DEBUG_CAM) { const d = window.DEBUG_CAM; cam.position.set(d.x, d.y, d.z); cam.rotation.set(d.pitch ?? 0, d.yaw ?? 0, 0, 'YXZ'); }   // câmera livre de depuração
    if (this.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 1.5); }
    const sniper = aim && !!this.cfg.weapons[w?.id]?.scope && st === 'alive';
    const baseFov = settings.get('fov');
    const fov = st === 'alive' ? (aim ? (sniper ? 22 : baseFov * 0.72) : body.sprinting ? baseFov + 7 : baseFov) : baseFov;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();
    input.zoomScale = sniper ? 0.35 : 1;

    if (this.self) {
      const show = ['freefall', 'parachute'].includes(st);
      this.self.root.visible = show; this.self.weapon.visible = false; if (this.self.chute) this.self.chute.visible = st === 'parachute';
      if (show) this.self.animator.update(dt, { x: pos.x, y: pos.y, z: pos.z, yaw: input.yaw, pitch: 0, vx: body.vel.x, vz: body.vel.z, state: st, stance: 'stand', grounded: false, weapon: null });
    }

    this.vm.setWeapon(st === 'alive' ? (inv?.active === 'knife' ? 'knife' : w?.id ?? null) : null);
    this.vm.update(dt, { ads: aim, sprint: body.sprinting, moving: Math.hypot(body.vel.x, body.vel.z) > 1 && body.grounded, speed: Math.hypot(body.vel.x, body.vel.z), slide: !!body.slide, grounded: body.grounded,
      action: y.action?.type, actionTime: y.action?.total, mouseDX: input.lastDX ?? 0, mouseDY: input.lastDY ?? 0, visible: st === 'alive', sniperScope: sniper });
    input.lastDX = input.lastDY = 0;

    this.audio.listener(cam.position, input.yaw); this.audio.setWind(st === 'freefall' || st === 'parachute', st === 'freefall' ? 1.4 : 0.6);

    const u = world.grade.uniforms, hurt = Math.max(0, 1 - (performance.now() - this.hurtT) / 600);
    u.damage.value = Math.min(1, Math.max(hurt * 0.8, (100 - y.hp) / 120));
    u.gas.value += ((y.zone.outside > 0 && !['awaiting', 'eliminated', 'aircraft'].includes(st) ? 1 : 0) - u.gas.value) * Math.min(1, dt * 4);
    u.ads.value += ((aim ? 1 : 0) - u.ads.value) * Math.min(1, dt * 8); u.downed.value = st === 'downed' ? 1 : 0;

    const def = w && this.cfg.weapons[w.id];
    hud.update({ snap: this.snap, cfg: this.cfg, yaw: input.yaw, pos, mapView: this.mapView, geo: this.geo, stations: this.stations, boards: this.boards, others, myName: this.myName,
      prompt: st === 'alive' ? this.promptText() : null,
      spectatingName: y.spectating && (others.find(o => o.id === y.spectating)?.n), ads: aim, hideCrosshair: aim || body.sprinting || st !== 'alive',
      spread: def ? (def.spreadHip * 400 + 4) * (Math.hypot(body.vel.x, body.vel.z) > 1 ? 1.5 : 1) : 6, sniperScope: sniper, breath: sniper ? { left: this.sway?.breath ?? 5, hold: !!this.sway?.hold } : null,
      netText: this.meta.mode === 'offline' ? `offline · ${this.meta.label}` : `ping ${Math.round(this.net.rtt * 1000)} ms · correções ${this.pred.corrections}` });
    if (this.shopOpen && !this.nearStation()) this.toggleShop(false);

    world.update(dt, this.snap, cam.position, time);
    this.effects.update(dt);
    world.render();
  }
  /** Ping: raio da câmera; inimigo perto da linha → 'enemy', item → 'loot', senão ponto no chão. */
  sendPing() {
    const cam = this.world.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const t = this.geo.raycast(o, d, 350) ?? 350, hit = o.clone().addScaledVector(d, t);
    let kind = 'go', at = hit;
    for (const e of this.snap.others) {
      if (e.a || e.s !== 'alive') continue;
      const v = new THREE.Vector3(e.x - o.x, e.y + 1.2 - o.y, e.z - o.z), along = v.dot(d);
      if (along < 0 || along > t + 2) continue;
      if (v.addScaledVector(d, -along).length() < Math.max(1.2, along * 0.02)) { kind = 'enemy'; at = new THREE.Vector3(e.x, e.y + 1.2, e.z); break; }
    }
    if (kind === 'go') for (const m of this.world.loot.values()) { const it = m.userData.item; if (Math.hypot(it.x - hit.x, it.z - hit.z) < 1.5) { kind = 'loot'; at = new THREE.Vector3(it.x, it.y + 0.3, it.z); break; } }
    this.net.send(C2S.MARK, { x: at.x, y: at.y, z: at.z, kind });
  }
  /** Marcadores do mundo: aliados, abatidos, pings. */
  worldMarkers(others) {
    const me = this.pred.body.pos, list = [], now = performance.now();
    for (const o of others) {
      if (!o.a || !['alive', 'downed', 'parachute', 'freefall'].includes(o.s)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      list.push({ x: o.x, y: o.y + 2.2, z: o.z, cls: o.s === 'downed' ? 'down' : 'ally', label: `${o.n} · ${Math.round(d)}m`, edge: o.s === 'downed' });
    }
    this.pings = (this.pings ?? []).filter(p => p.until > now);
    for (const p of this.pings) list.push({ x: p.x, y: p.y + 0.4, z: p.z, cls: p.kind === 'enemy' ? 'enemy ping' : 'ping', label: `${p.kind === 'enemy' ? 'INIMIGO' : p.kind === 'loot' ? 'ITEM' : ''} ${Math.round(Math.hypot(p.x - me.x, p.z - me.z))}m`, edge: true });
    this.hud.markers(list, this.world.camera);
  }
  /** Passos de outros jogadores (só perto, andando sem agachar) — ouvir é informação tática. */
  remoteSteps(others, dt) {
    const me = this.pred.body.pos; this.stepMap ??= new Map();
    for (const o of others) {
      if (o.s !== 'alive' || o.gr === 0 || o.st !== 'stand') continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z); if (d > 32) continue;
      const sp = Math.hypot(o.vx ?? 0, o.vz ?? 0); if (sp < 2.5) continue;
      const a = (this.stepMap.get(o.id) ?? 0) + sp * dt;
      if (a > (o.spr ? 2.4 : 1.9)) { this.stepMap.set(o.id, 0); this.audio.step({ x: o.x, y: o.y, z: o.z }, o.spr ? 1.4 : 1, o.y > (this.geo?.terrain?.heightAt(o.x, o.z) ?? 0) + 0.3 ? 'hard' : 'dirt'); }
      else this.stepMap.set(o.id, a);
    }
  }
  onLand(speed) { this.vm.landed(speed); this.landDip = Math.min(0.28, speed * 0.022); this.audio.land(speed); }
  /** Superfície sob o jogador para o som do passo. */
  surfaceAt(p) {
    const g = this.geo; if (!g) return 'dirt';
    const t = g.terrain ? g.terrain.heightAt(p.x, p.z) : 0;
    return p.y > t + 0.3 ? 'hard' : 'dirt';
  }
  promptText() {
    const p = this.pred.body.pos;
    const ally = this.snap.others.find(o => o.a && o.s === 'downed' && Math.hypot(o.x - p.x, o.z - p.z) <= this.cfg.downed.reviveRange);
    if (ally) return `<b>[Segure E]</b> Reviver ${ally.n}`;
    const ch = this.nearestChest(); if (ch) return `${keyHint('interact')} Abrir baú de suprimentos`;
    const it = this.nearestLoot();
    if (it?.type === 'weapon') {   // card da arma no chão: silhueta, nome, família, raridade e as teclas
      const d = this.cfg.weapons[it.data.id], R = this.cfg.rarity?.[it.rarity], CLS = { pistol: 'Pistola', smg: 'Submetralhadora', ar: 'Fuzil de assalto', shotgun: 'Escopeta', dmr: 'Fuzil de precisão', sniper: 'Sniper' };
      const held = this.snap.you.inv?.[this.snap.you.inv.active];
      return `<div class="lc-keys"><span>${keyHint('interact')} ${held && this.snap.you.inv.primary && this.snap.you.inv.secondary ? 'TROCAR' : 'EQUIPAR'}</span><span>${keyHint('ping')} MARCAR</span></div>
        <div class="lootcard" style="--rc:${RAR_COLOR[it.rarity]}"><img src="${UI_URL}w_${it.data.id}.png" alt=""><div><b>${d?.name}</b><small>${CLS[d?.class] ?? ''}</small><em>${R?.label ?? it.rarity}</em></div></div>`;
    }
    if (it) return `${keyHint('interact')} ${this.pickupText(it.type, it.data)}`;
    const b = this.nearBoard(); if (b) return `<b>[F]</b> Aceitar contrato: ${b.name}`;
    if (this.nearStation()) return '<b>[B]</b> Estação de compra';
    return null;
  }
  idleCamera(t) { const c = this.world.camera; c.position.set(Math.cos(t / 12) * 170, 70, Math.sin(t / 12) * 170); c.lookAt(0, 0, 0); this.world.update(0.016, null, c.position, t); }

  dispose() {
    this.net.close();
    this.input.off('action', this.onAction); this.input.off('release', this.onRelease); this.input.off('swap', this.onSwap); this.input.off('fireDown', this.onFireDown);
    removeEventListener('keydown', this.keyTab); removeEventListener('keyup', this.keyTab);
    $('shop').removeEventListener('click', this.shopClick); $('shop').classList.add('hidden'); $('bigmap').classList.add('hidden');
    this.avatars.clear(); if (this.self) this.world.scene.remove(this.self.root, this.self.weapon); this.vm.space.parent?.remove(this.vm.space);
    this.world.clearMatch?.();
  }
}
