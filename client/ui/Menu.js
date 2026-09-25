import { settings } from '../core/Settings.js';
import { career, levelFromXp } from '../core/Career.js';
import { OPERATORS, MODES, DIFFICULTIES, PLAYER_COUNTS, operatorOf } from '../core/Operators.js';
import { challenges } from '../core/Challenges.js';
import { makeConfig } from '../../shared/config.js';
import { KEYMAP, KEY_LABELS, keyName } from '../game/InputSystem.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Esquema da tela de configurações (reusado na pausa). */
export const SETTINGS_SCHEMA = [
  { key: 'sensitivity', label: 'Sensibilidade do mouse', type: 'range', min: 0.0006, max: 0.006, step: 0.0001, fmt: v => (v * 1000).toFixed(1) },
  { key: 'adsSensitivity', label: 'Sensibilidade ao mirar', type: 'range', min: 0.2, max: 1.2, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'fov', label: 'Campo de visão (FOV)', type: 'range', min: 60, max: 100, step: 1, fmt: v => `${v}°` },
  { key: 'invertY', label: 'Inverter eixo Y', type: 'toggle' },
  { key: 'volume', label: 'Volume geral', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'sfxVolume', label: 'Efeitos sonoros', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'musicVolume', label: 'Música do menu', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'quality', label: 'Qualidade gráfica', type: 'select', options: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']], hint: 'sombras, grama, distância de visão' },
  { key: 'dynamicRes', label: 'Resolução dinâmica', type: 'toggle', hint: 'baixa a resolução interna se o FPS cair' },
  { key: 'knifeHold', label: 'Segurar V para equipar a faca', type: 'range', min: 0.3, max: 3, step: 0.1, fmt: v => `${Number(v).toFixed(1)} s`, hint: 'um toque em V sempre dá o golpe rápido' },
  { key: 'crouchToggle', label: 'Agachar alterna (em vez de segurar)', type: 'toggle' },
  { key: 'aimToggle', label: 'Mirar alterna (em vez de segurar)', type: 'toggle' },
  { key: 'damageNumbers', label: 'Números de dano', type: 'toggle' },
  { key: 'showFps', label: 'Mostrar FPS', type: 'toggle' },
];

export function renderSettings(box) {
  box.innerHTML = SETTINGS_SCHEMA.map(s => {
    const v = settings.get(s.key);
    const ctl = s.type === 'range' ? `<input type="range" data-k="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">`
      : s.type === 'toggle' ? `<select data-k="${s.key}" data-bool="1"><option value="1" ${v ? 'selected' : ''}>Sim</option><option value="0" ${!v ? 'selected' : ''}>Não</option></select>`
      : `<select data-k="${s.key}">${s.options.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="set-row"><span>${s.label}${s.hint ? `<small>${s.hint}</small>` : ''}</span>${ctl}<output data-o="${s.key}">${s.fmt ? s.fmt(v) : ''}</output></div>`;
  }).join('');
  box.oninput = e => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    const s = SETTINGS_SCHEMA.find(x => x.key === k);
    const v = el.dataset.bool ? el.value === '1' : s.type === 'range' ? Number(el.value) : el.value;
    settings.set(k, v);
    const out = box.querySelector(`[data-o="${k}"]`); if (out && s.fmt) out.textContent = s.fmt(v);
  };
}

/** Controles remapeáveis: clique numa tecla, aperte a nova (Esc cancela). Conflito = troca as duas. */
export function renderControls(box) {
  const custom = { ...(settings.get('keys') ?? {}) };
  box.innerHTML = `<div class="ctl-top"><span class="muted">Clique numa tecla e aperte a nova · Esc cancela</span><button class="ghost small" data-reset="1">RESTAURAR PADRÃO</button></div>`
    + Object.entries(KEY_LABELS).map(([action, label]) => `<div class="ctl"><span>${label}</span><button class="keybtn" data-act="${action}">${keyName([].concat(KEYMAP[action])[0])}</button></div>`).join('')
    + `<div class="ctl"><span>Atirar / Mirar</span><span><kbd>Clique</kbd> <kbd>Botão direito</kbd></span></div>`
    + `<div class="ctl"><span>Trocar arma</span><span><kbd>Roda do mouse</kbd></span></div>`
    + `<div class="ctl"><span>Sprint tático</span><span>correr duas vezes</span></div>`;
  box.onclick = e => {
    if (e.target.closest('[data-reset]')) { settings.set('keys', {}); renderControls(box); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act; b.textContent = '…'; b.classList.add('wait');
    const onKey = ev => {
      ev.preventDefault(); ev.stopPropagation(); removeEventListener('keydown', onKey, true);
      if (ev.code !== 'Escape') {
        const prev = [].concat(KEYMAP[act])[0], other = Object.keys(KEYMAP).find(a => a !== act && [].concat(KEYMAP[a])[0] === ev.code);
        custom[act] = ev.code; if (other) custom[other] = prev;       // conflito: troca
        settings.set('keys', custom);
      }
      renderControls(box);
    };
    addEventListener('keydown', onKey, true);
  };
}

/**
 * Menu — telas do menu principal. Não conhece a partida: dispara callbacks.
 *   onPlayOffline({ squadSize, difficulty, players })  onPlayOnline(party)
 */
export class Menu {
  constructor({ onPlayOffline, onPlayOnline }) {
    this.onPlayOffline = onPlayOffline; this.onPlayOnline = onPlayOnline;
    this.mode = { ...settings.get('lastMode') };
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => this.go(b.dataset.go)));
    $('startOffline').onclick = () => { settings.set('lastMode', this.mode); this.onPlayOffline({ ...this.mode }); };
    $('connectOnline').onclick = () => this.onPlayOnline($('partyCode').value.trim());
    $('playerName').value = settings.get('name');
    $('playerName').oninput = e => { settings.set('name', e.target.value.slice(0, 16)); this.renderCard(); };
    this.cfg = makeConfig({}); this.chKind = 'daily'; this.screen = 'home';
    document.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { this.chKind = b.dataset.ch; this.renderChallenges(); });
    $('tokUse').onclick = () => { if (career.useToken()) this.renderQuest(); };
    $('muteBtn').onclick = () => { const v = settings.get('volume') > 0 ? 0 : 0.6; settings.set('volume', v); $('muteBtn').textContent = v ? '🔊' : '🔇'; };
    this.renderPlay(); this.renderOperators(); this.renderCard(); this.renderLobby();
    renderSettings($('settingsBox')); renderControls($('controlsBox'));
    setInterval(() => { if (!$('menu').classList.contains('hidden')) this.renderTimers(); }, 30000);
  }
  show(on = true) { $('menu').classList.toggle('hidden', !on); if (on) { this.renderCard(); this.renderCareer(); this.renderLobby(); } }
  /** Estado lido pela cena 3D do lobby (operador, arma exibida, enquadramento da câmera). */
  get view() { return { operator: settings.get('operator'), weapon: settings.get('lobbyWeapon') || 'rifle', focus: this.screen === 'weapons' ? 'weapons' : this.screen === 'operator' ? 'operators' : 'lobby' }; }
  go(screen) {
    document.querySelectorAll('[data-screen]').forEach(s => s.classList.toggle('hidden', s.dataset.screen !== screen));
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('on', n.dataset.go === screen));
    if (screen === 'career') this.renderCareer();
    if (screen === 'settings') renderSettings($('settingsBox'));
    if (screen === 'weapons') this.renderWeapons();
    if (screen === 'play') return this.go('home');
    this.screen = screen;
  }

  renderCard() {
    const op = operatorOf(settings.get('operator')), lv = career.level, deg = Math.round(lv.progress * 360);
    $('playerCard').innerHTML = `<div class="ring" style="--p:${deg}deg"><b>${lv.level}</b></div><div class="pc-txt"><b>${esc(settings.get('name') || 'Jogador')}</b><small>${op.name} · ${career.data.wins} vitórias</small></div>`;
    $('opTag').innerHTML = `<b>${lv.level}</b><span>${esc(settings.get('name') || 'Jogador')}</span>`;
  }

  renderPlay() {
    const m = this.mode;
    $('teamCards').innerHTML = MODES.map(x => `<button class="team-card ${m.squadSize === x.size ? 'on' : ''}" data-size="${x.size}" style="background-image:url('assets/ui/squad_${x.size}.jpg')"><b>${x.name}</b><small>${x.desc}</small></button>`).join('');
    $('diffSeg').innerHTML = DIFFICULTIES.map(d => `<button class="${m.difficulty === d.id ? 'on' : ''}" data-d="${d.id}" title="${d.desc}">${d.name}</button>`).join('');
    $('playersSeg').innerHTML = PLAYER_COUNTS.map(p => `<button class="${m.players === p.n ? 'on' : ''}" data-n="${p.n}" title="${p.desc}">${p.n}</button>`).join('');
    $('teamCards').onclick = e => { const t = e.target.closest('[data-size]'); if (t) { m.squadSize = +t.dataset.size; settings.set('lastMode', m); this.renderPlay(); } };
    $('diffSeg').onclick = e => { const t = e.target.closest('[data-d]'); if (t) { m.difficulty = t.dataset.d; settings.set('lastMode', m); this.renderPlay(); } };
    $('playersSeg').onclick = e => { const t = e.target.closest('[data-n]'); if (t) { m.players = +t.dataset.n; settings.set('lastMode', m); this.renderPlay(); } };
    $('modeSub').textContent = `${MODES.find(x => x.size === m.squadSize)?.name ?? ''} · ${m.players} JOGADORES · ${DIFFICULTIES.find(d => d.id === m.difficulty)?.name ?? ''}`;
  }

  renderLobby() { this.renderChallenges(); this.renderQuest(); this.renderTimers(); }
  renderTimers() {
    const r = challenges.resetIn(), f = ms => { const h = Math.floor(ms / 3600000), d = Math.floor(h / 24); return d ? `${d}D ${h % 24}H` : `${h}H ${Math.floor(ms / 60000) % 60}M`; };
    $('chDaily').textContent = f(r.daily); $('chWeekly').textContent = f(r.weekly);
    $('resetInfo').textContent = `⏱ ${f(r.daily)}`;
    const end = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1); $('seasonLeft').textContent = `${Math.ceil((end - Date.now()) / 86400000)} DIAS RESTANTES`;
  }
  renderChallenges() {
    document.querySelectorAll('[data-ch]').forEach(b => b.classList.toggle('on', b.dataset.ch === this.chKind));
    const list = challenges.list(this.chKind);
    $('chList').innerHTML = list.map(c => `<div class="ch ${c.done ? 'done' : ''}"><div class="ch-ic">${c.done ? '✔' : '◈'}</div><div class="ch-txt">${c.text}<div class="ch-bar"><i style="width:${c.p / c.n * 100}%"></i></div></div><div class="ch-prog"><b>${c.done ? c.n : c.p}</b><span>${c.n}</span></div><div class="ch-xp"><i>XP</i>${c.xp}</div></div>`).join('')
      + `<div class="ch bonus"><div class="ch-ic">✚</div><div class="ch-txt"><b>BÔNUS:</b> jogue e sobreviva para ganhar XP de carreira</div><div class="ch-prog"><b>∞</b></div><div class="ch-xp ok">✓</div></div>`;
    $('chCount').textContent = list.filter(c => !c.done).length;
  }
  renderQuest() {
    const d = career.data, max = 10, now = Math.min(max, d.wins);
    $('questNow').textContent = now; $('questMax').textContent = max; $('questBar').style.width = `${now / max * 100}%`;
    $('tokCount').textContent = d.tokens; $('tokInfo').textContent = `${d.tokens} FICHAS DE XP`;
    $('tokLabel').innerHTML = d.bonus ? '<b style="color:var(--green)">XP EM DOBRO</b> NA PRÓXIMA PARTIDA' : 'SEM BÔNUS DE XP ATIVO';
    $('tokUse').classList.toggle('on', d.bonus); $('tokUse').disabled = d.bonus || d.tokens <= 0;
  }
  /** Aba ARMAS: lista por família + atributos da selecionada (exibida no operador do lobby). */
  renderWeapons() {
    const W = this.cfg.weapons, sel = settings.get('lobbyWeapon') || 'rifle', groups = { pistol: 'PISTOLAS', smg: 'SUBMETRALHADORAS', ar: 'FUZIS DE ASSALTO', shotgun: 'ESCOPETAS', dmr: 'PRECISÃO', sniper: 'PRECISÃO' };
    const byG = {}; for (const [id, w] of Object.entries(W)) (byG[groups[w.class] ?? 'OUTRAS'] ??= []).push([id, w]);
    $('weaponList').innerHTML = Object.entries(byG).map(([g, ws]) => `<div class="wp-group">${g}</div>` + ws.map(([id, w]) => `<button class="wp ${id === sel ? 'on' : ''}" data-w="${id}"><b>${w.name}</b><small>${w.slot === 'primary' ? 'PRIMÁRIA' : 'SECUNDÁRIA'} · ${w.mag} tiros</small></button>`).join('')).join('');
    $('weaponList').onclick = e => { const b = e.target.closest('[data-w]'); if (b) { settings.set('lobbyWeapon', b.dataset.w); this.renderWeapons(); } };
    const w = W[sel], all = Object.values(W), rel = (v, k) => v / Math.max(...all.map(x => x[k] * (x.pellets ?? 1)));
    const bars = [['DANO', Math.min(1, w.damage * (w.pellets ? w.pellets * 0.55 : 1) / 115)], ['CADÊNCIA', w.rpm / Math.max(...all.map(x => x.rpm))], ['ALCANCE', w.range / Math.max(...all.map(x => x.range))],
      ['PRECISÃO', 1 - w.spreadAds / Math.max(...all.map(x => x.spreadAds))], ['CONTROLE', 1 - (w.recoil - 0.5) / 3.2], ['MOBILIDADE', w.class === 'pistol' ? 1 : w.class === 'smg' ? 0.85 : w.class === 'ar' ? 0.65 : w.class === 'shotgun' ? 0.6 : 0.4]];
    $('weaponStats').innerHTML = `<h3>${w.name}</h3>` + bars.map(([k, v]) => `<div class="wp-bar"><span>${k}</span><div><i style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></i></div></div>`).join('')
      + `<div class="wp-meta">${w.damage}${w.pellets ? `×${w.pellets}` : ''} dano · ${w.rpm} disparos/min · pente ${w.mag} · recarga ${w.reload}s</div>`;
  }

  renderOperators() {
    const cur = settings.get('operator');
    $('opGrid').innerHTML = OPERATORS.map((o, i) => `<div class="op-card ${cur === i ? 'on' : ''}" data-op="${i}" style="background-image:url('${o.img}')"><i style="background:${o.swatch}"></i><div><b>${o.name}</b><small>${o.desc}</small></div></div>`).join('');
    $('opGrid').onclick = e => { const c = e.target.closest('[data-op]'); if (c) { settings.set('operator', +c.dataset.op); this.renderOperators(); this.renderCard(); } };
  }

  renderCareer() {
    const d = career.data, lv = levelFromXp(d.xp), kd = d.deaths ? (d.kills / d.deaths).toFixed(2) : d.kills.toFixed(2);
    const t = s => `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}min`;
    $('careerBox').innerHTML = `<div class="stat-grid">
      <div class="stat"><b>${lv.level}</b><span>NÍVEL · ${lv.into}/${lv.needed} XP</span></div>
      <div class="stat"><b>${d.matches}</b><span>PARTIDAS</span></div><div class="stat"><b>${d.wins}</b><span>VITÓRIAS</span></div>
      <div class="stat"><b>${d.top5}</b><span>TOP 5</span></div><div class="stat"><b>${d.kills}</b><span>ELIMINAÇÕES</span></div>
      <div class="stat"><b>${kd}</b><span>ELIM./MORTE</span></div><div class="stat"><b>${d.damage}</b><span>DANO TOTAL</span></div>
      <div class="stat"><b>${d.contracts}</b><span>CONTRATOS</span></div><div class="stat"><b>${d.bestPlacement ?? '-'}</b><span>MELHOR POSIÇÃO</span></div>
      <div class="stat"><b>${t(d.timePlayed)}</b><span>TEMPO DE JOGO</span></div></div>
      <h3 style="letter-spacing:3px;color:var(--accent);font-size:12px;margin-bottom:8px">ÚLTIMAS PARTIDAS</h3>
      ${d.history.length ? `<table class="hist"><tr><th>Quando</th><th>Modo</th><th>Posição</th><th>Elim.</th><th>Dano</th><th>XP</th></tr>${d.history.map(h => `<tr><td>${new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(h.mode)}</td><td>#${h.placement}</td><td>${h.kills}</td><td>${h.damage}</td><td>+${h.xp}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhuma partida ainda. Que tal a primeira?</p>'}`;
  }

  setOnlineStatus(text) { $('onlineStatus').textContent = text; }
  lobby(l, myId) {
    $('lobbyBox').classList.remove('hidden');
    $('lobbyHead').innerHTML = `LOBBY · ${MODES.find(m => m.size === l.squadSize)?.name ?? ''} · ${l.players.length} jogadores · ${l.state === 'countdown' ? `começa em <b>${l.countdown}s</b>` : 'aguardando jogadores'}`;
    $('lobbyList').innerHTML = l.players.map(p => `<div>${p.id === myId ? '★ ' : ''}${esc(p.name)}${p.bot ? ' <span class="muted">bot</span>' : ''}${p.party ? ` <span class="muted">[${esc(p.party)}]</span>` : ''}</div>`).join('');
  }
  hideLobby() { $('lobbyBox').classList.add('hidden'); }
}
