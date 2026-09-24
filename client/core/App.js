import { settings } from './Settings.js';
import { career, levelFromXp } from './Career.js';
import { offlineOverrides, MODES, DIFFICULTIES } from './Operators.js';
import { NetClient } from '../net/NetClient.js';
import { WebSocketTransport, WorkerTransport } from '../net/Transports.js';
import { InputSystem } from '../game/InputSystem.js';
import { GameSession } from '../game/GameSession.js';
import { World } from '../render/World.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { HUDSystem } from '../ui/HUDSystem.js';
import { Menu, renderSettings, renderControls } from '../ui/Menu.js';
import { assets } from '../assets/AssetManager.js';

const $ = id => document.getElementById(id);
const TIPS = [
  'Morreu com um aliado vivo? Você volta de paraquedas enquanto o ressurgimento estiver ativo.',
  'Eliminações do seu squad reduzem o tempo de retorno dos aliados.',
  'Segure Q para aplicar várias placas seguidas.',
  'C enquanto corre faz um slide. Espaço perto de muretas faz vault.',
  'Estações de compra (ícone verde) vendem placas, munição e o Kit de Retorno.',
  'Tablets amarelos dão contratos: dinheiro, XP e loot melhor.',
  'Baús de suprimento guardam armas raras. Segure E para abrir.',
  'A zona ignora armadura. Fique de olho na bússola.',
  'Granadas de fumaça (T) bloqueiam a visão dos inimigos, inclusive dos bots.',
];

/**
 * App — fluxo do jogo: menu → carregando → partida → pausa → fim.
 * Cria uma GameSession por partida; renderizador, áudio, HUD e input são únicos.
 */
export class App {
  constructor() {
    this.canvas = $('gl');
    this.world = new World(this.canvas);
    this.input = new InputSystem(this.canvas);
    this.audio = new AudioSystem();
    this.hud = new HUDSystem();
    this.session = null; this.lastOffline = null; this.pausedByUser = false;
    this.menu = new Menu({ onPlayOffline: o => this.startOffline(o), onPlayOnline: p => this.startOnline(p) });
    settings.on(({ key }) => this.applySettings(key));
    this.applySettings();
    this.bindOverlays();
    addEventListener('pointerdown', () => { this.audio.unlock(); if (!this.session) this.audio.menuMusic(true); });
    document.addEventListener('pointerlockchange', () => this.onPointerLock());
    this.canvas.addEventListener('click', () => this.session?.requestLock());
    assets.preload();                                   // modelos 3D em segundo plano enquanto o menu está aberto
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
  }

  applySettings(key) {
    const q = settings.quality;
    if (!key || key === 'quality') this.world.applyQuality(q);
    if (!key || ['volume', 'sfxVolume', 'musicVolume'].includes(key)) this.audio.setVolumes(settings.get('volume'), settings.get('sfxVolume'), settings.get('musicVolume'));
    if (!key || key === 'showFps') $('fps').classList.toggle('hidden', !settings.get('showFps'));
  }

  // ------------------------------------------------------------ sessões
  playerHello(party = null) { return { name: settings.get('name') || 'Jogador', party, operator: settings.get('operator') }; }

  startOffline(opts) {
    this.lastOffline = opts;
    const mode = `${MODES.find(m => m.size === opts.squadSize)?.name ?? ''} · ${DIFFICULTIES.find(d => d.id === opts.difficulty)?.name ?? ''} · ${opts.players}`;
    const net = new NetClient(new WorkerTransport(offlineOverrides(opts)));
    this.begin(net, { mode: 'offline', label: mode, options: opts });
    this.showLoading(true);
    net.connect(this.playerHello());
  }

  startOnline(party) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const net = new NetClient(new WebSocketTransport(url));
    this.menu.setOnlineStatus('Conectando ao servidor…');
    let opened = false;
    net.on('status', s => { if (s === 'online') { opened = true; this.menu.setOnlineStatus('Conectado. Aguardando a partida começar…'); } else if (!opened) this.menu.setOnlineStatus('Servidor não encontrado. Rode "npm start" e abra o jogo pelo endereço do servidor.'); });
    this.begin(net, { mode: 'online', label: 'ONLINE', party });
    net.connect(this.playerHello(party || null));
  }

  begin(net, meta) {
    this.end(false);
    this.audio.menuMusic(false);
    this.session = new GameSession(this, net, meta);
  }

  /** Encerra a sessão atual e volta ao menu. */
  end(showMenu = true) {
    if (this.session) { this.session.dispose(); this.session = null; }
    this.hud.show(false); this.hidePause(); $('end').classList.add('hidden'); this.showLoading(false);
    this.input.enabled = false; this.input.resetToggles();
    if (document.pointerLockElement) document.exitPointerLock();
    if (showMenu) { this.menu.show(true); this.menu.hideLobby(); this.audio.menuMusic(true); }
  }

  // ------------------------------------------------------------ telas
  showLoading(on, stage) {
    $('loading').classList.toggle('hidden', !on);
    if (on) { $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; this.setLoading(stage ?? 'Preparando partida…', 0.1); }
  }
  setLoading(stage, p) { $('loadStage').textContent = stage; $('loadBar').style.width = `${Math.round(Math.min(1, p) * 100)}%`; }

  bindOverlays() {
    $('resumeBtn').onclick = () => this.resume();
    $('leaveBtn').onclick = () => this.end(true);
    $('pauseSettings').onclick = () => { const p = $('pausePanel'); p.className = 'settings-grid'; renderSettings(p); };
    $('pauseControls').onclick = () => { const p = $('pausePanel'); p.className = 'controls-grid'; renderControls(p); };
    $('endMenu').onclick = () => this.end(true);
    $('endAgain').onclick = () => { if (this.session?.meta.mode === 'offline' && this.lastOffline) this.startOffline(this.lastOffline); else { $('end').classList.add('hidden'); this.session?.waitNextMatch(); } };
  }

  onPointerLock() {
    const locked = document.pointerLockElement === this.canvas;
    const s = this.session;
    if (!s) return;
    if (locked) { this.hidePause(); return; }
    // perdeu o mouse durante a partida sem abrir loja/mapa: pausa
    if (s.inMatch && !s.wantsCursor()) this.showPause();
  }
  showPause() {
    const s = this.session; if (!s) return;
    $('pause').classList.remove('hidden'); $('pausePanel').classList.add('hidden'); $('pausePanel').innerHTML = '';
    const offline = s.meta.mode === 'offline';
    $('pauseTitle').textContent = offline ? 'PAUSADO' : 'MENU';
    $('pauseSub').textContent = offline ? 'A partida está congelada.' : 'Partida online: o jogo continua rodando.';
    if (offline) s.net.pause(true);
    this.pausedByUser = true; this.input.enabled = false;
  }
  hidePause() { $('pause').classList.add('hidden'); if (this.pausedByUser) { this.session?.net.pause(false); this.pausedByUser = false; } if (this.session?.inMatch) this.input.enabled = true; }
  resume() { this.hidePause(); this.session?.requestLock(); }

  showEnd(e, me) {
    const s = this.session, r = e.results.find(x => x.id === me);
    const won = e.winnerSquad && r?.squadId === e.winnerSquad;
    const rec = r ? career.record(r, { mode: s?.meta.label, squads: new Set(e.results.map(x => x.squadId)).size }) : null;
    $('end').classList.remove('hidden');
    $('endTitle').textContent = won ? 'VITÓRIA!' : `${r?.placement ?? '?'}º LUGAR`;
    $('endTitle').style.color = won ? 'var(--accent)' : '#fff';
    const f = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('endStats').innerHTML = (r ? `<div class="end-stats"><div><b>${r.placement}º</b>posição</div><div><b>${r.kills}</b>eliminações</div><div><b>${r.damage}</b>dano causado</div><div><b>${f(r.survived)}</b>tempo sobrevivido</div><div><b>${r.contracts}</b>contratos</div><div><b>$${r.cash}</b>dinheiro obtido</div><div><b>${r.revives ?? 0}</b>reviveu</div></div>` : '')
      + `<table class="results" style="margin-top:14px"><tr><th>#</th><th>Jogador</th><th>Elim.</th><th>Dano</th><th>Tempo</th><th>Contratos</th><th>$</th></tr>${e.results.slice(0, 12).map(x => `<tr style="${x.id === me ? 'color:var(--accent)' : ''}"><td>${x.placement}</td><td>${x.name}</td><td>${x.kills}</td><td>${x.damage}</td><td>${f(x.survived)}</td><td>${x.contracts}</td><td>${x.cash}</td></tr>`).join('')}</table>`;
    if (rec) {
      const lv = rec.after, up = rec.after.level > rec.before.level;
      $('endXp').innerHTML = `<b>+${rec.xp.total} XP</b>${up ? ` · <span style="color:var(--green)">SUBIU PARA O NÍVEL ${lv.level}!</span>` : ''}
        ${rec.xp.parts.map(([k, v]) => `<div class="line"><span>${k}</span><span>+${v}</span></div>`).join('')}
        <div class="line" style="margin-top:6px"><span>Nível ${lv.level}</span><span>${lv.into}/${lv.needed}</span></div><div class="lvbar"><i style="width:0"></i></div>`;
      requestAnimationFrame(() => { const bar = $('endXp').querySelector('.lvbar i'); if (bar) bar.style.width = `${Math.round(lv.progress * 100)}%`; });
    } else $('endXp').innerHTML = '';
    $('endAgain').textContent = s?.meta.mode === 'offline' ? 'JOGAR NOVAMENTE' : 'PRÓXIMA PARTIDA';
    void levelFromXp;
  }

  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    if (settings.get('showFps')) $('fps').textContent = `${Math.round(this.fps)} FPS`;
    if (this.session) this.session.frame(dt, t / 1000);
  }
}
