import { settings } from '../core/Settings.js';
import { career, levelFromXp } from '../core/Career.js';
import { OPERATORS, MODES, DIFFICULTIES, PLAYER_COUNTS, operatorOf } from '../core/Operators.js';
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

export function renderControls(box) {
  box.innerHTML = Object.entries(KEY_LABELS).map(([action, label]) =>
    `<div class="ctl"><span>${label}</span><span>${[].concat(KEYMAP[action] ?? action).map(k => `<kbd>${keyName(k)}</kbd>`).join(' ')}</span></div>`).join('')
    + `<div class="ctl"><span>Atirar / Mirar</span><span><kbd>Clique</kbd> <kbd>Botão direito</kbd></span></div>`
    + `<div class="ctl"><span>Trocar arma</span><span><kbd>Roda do mouse</kbd></span></div>`
    + `<div class="ctl"><span>Sprint tático</span><span><kbd>Shift</kbd> duas vezes</span></div>`
    + `<div class="ctl"><span>Slide</span><span><kbd>C</kbd> correndo</span></div>`
    + `<div class="ctl"><span>Mantle / vault / escalar</span><span><kbd>Espaço</kbd> perto do obstáculo</span></div>`;
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
    this.renderPlay(); this.renderOperators(); this.renderCard();
    renderSettings($('settingsBox')); renderControls($('controlsBox'));
  }
  show(on = true) { $('menu').classList.toggle('hidden', !on); if (on) { this.renderCard(); this.renderCareer(); } }
  go(screen) {
    document.querySelectorAll('[data-screen]').forEach(s => s.classList.toggle('hidden', s.dataset.screen !== screen));
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('on', n.dataset.go === screen));
    if (screen === 'career') this.renderCareer();
    if (screen === 'settings') renderSettings($('settingsBox'));
    this.screen = screen;
  }

  renderCard() {
    const op = operatorOf(settings.get('operator')), lv = career.level;
    $('playerCard').innerHTML = `<img src="${op.img}" alt=""><div class="lv">${lv.level}</div><div style="flex:1"><b>${esc(settings.get('name') || 'Jogador')}</b><div class="muted">${op.name} · ${career.data.wins} vitórias</div><div class="xpbar"><i style="width:${Math.round(lv.progress * 100)}%"></i></div></div>`;
  }

  renderPlay() {
    const m = this.mode;
    $('modeTiles').innerHTML = MODES.map(x => `<div class="tile ${m.squadSize === x.size ? 'on' : ''}" data-size="${x.size}"><div class="ic">${x.ic}</div><b>${x.name}</b><small>${x.desc}</small></div>`).join('');
    $('diffSeg').innerHTML = DIFFICULTIES.map(d => `<button class="${m.difficulty === d.id ? 'on' : ''}" data-d="${d.id}">${d.name}<small>${d.desc}</small></button>`).join('');
    $('playersSeg').innerHTML = PLAYER_COUNTS.map(p => `<button class="${m.players === p.n ? 'on' : ''}" data-n="${p.n}">${p.n}<small>${p.desc}</small></button>`).join('');
    $('modeTiles').onclick = e => { const t = e.target.closest('[data-size]'); if (t) { m.squadSize = +t.dataset.size; this.renderPlay(); } };
    $('diffSeg').onclick = e => { const t = e.target.closest('[data-d]'); if (t) { m.difficulty = t.dataset.d; this.renderPlay(); } };
    $('playersSeg').onclick = e => { const t = e.target.closest('[data-n]'); if (t) { m.players = +t.dataset.n; this.renderPlay(); } };
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
