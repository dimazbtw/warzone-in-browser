/**
 * HUDSystem — toda a interface em DOM/canvas 2D, alimentada só por snapshots/eventos.
 * Vida, armadura, munição, arma, inventário, dinheiro, minimapa, aliados,
 * Resurgence, zona (distância + direção), killfeed, mensagens, contrato,
 * estação, espectador, placar e tela final.
 */
const $ = id => document.getElementById(id);
const STATE = { alive: 'VIVO', downed: 'ABATIDO', awaiting: 'RETORNANDO', eliminated: 'ELIMINADO', freefall: 'QUEDA LIVRE', parachute: 'PARAQUEDAS', aircraft: 'AERONAVE' };
const RAR = { common: '#bbb', uncommon: '#6fd16f', rare: '#4fa8ff', epic: '#b36bff', legendary: '#ffb13a' };
const PX_PER_DEG = 3.2;

export class HUDSystem {
  constructor() {
    this.feed = []; this.center = { text: '', until: 0 }; this.toast = { text: '', until: 0 }; this.hitT = 0; this.dirs = [];
    this.mm = $('minimap').getContext('2d'); this.bm = $('bigmap').getContext('2d');
    this.shots = []; // pings de tiro inimigo no minimapa
    this.buildCompass();
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }
  announce(text, sec = 2.5) { this.center = { text, until: performance.now() + sec * 1000 }; }
  notify(text, sec = 2.5) { this.toast = { text, until: performance.now() + sec * 1000 }; }
  killfeed(text, me) { this.feed.unshift({ text, me, at: performance.now() }); this.feed.length = Math.min(this.feed.length, 6); }
  hitmarker(head, kill) { const h = $('hitmarker'); h.style.setProperty('--c', kill ? '#ff3b3b' : head ? '#ffd24d' : '#fff'); h.style.opacity = 1; this.hitT = performance.now() + (kill ? 300 : 120); }
  damageFrom(angle) { this.dirs.push({ angle, until: performance.now() + 700 }); }
  xp(text) { const el = document.getElementById('xpPop'), d = document.createElement('div'); d.textContent = text; el.appendChild(d); setTimeout(() => d.remove(), 1600); }
  /** Marcadores no mundo (aliados, pings, contrato), projetados na tela; reaproveita os nós do DOM. */
  markers(list, camera) {
    const root = $('worldMarkers'), W = root.clientWidth, H = root.clientHeight; this.wmPool ??= [];
    const v = this._v ??= camera.position.clone();
    let n = 0;
    for (const m of list) {
      v.set(m.x, m.y, m.z).project(camera);
      if (v.z > 1) { if (!m.edge) continue; v.x = -v.x; v.y = -1; }                    // atrás da câmera
      let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      if (m.edge) { x = Math.max(24, Math.min(W - 24, x)); y = Math.max(40, Math.min(H - 24, y)); }
      else if (x < 0 || x > W || y < 0 || y > H) continue;
      let el = this.wmPool[n]; if (!el) { el = document.createElement('div'); root.appendChild(el); this.wmPool[n] = el; }
      el.className = 'wm ' + m.cls; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.display = '';
      const html = `<i></i>${m.label ?? ''}`; if (el._h !== html) { el.innerHTML = html; el._h = html; }
      n++;
    }
    for (let i = n; i < this.wmPool.length; i++) this.wmPool[i].style.display = 'none';
  }
  damageNumber(x, y, amount, cls = '') {
    const d = document.createElement('div'); d.className = 'dn ' + cls; d.textContent = Math.round(amount);
    d.style.left = x + (Math.random() - 0.5) * 30 + 'px'; d.style.top = y + 'px'; $('dmgNumbers').appendChild(d); setTimeout(() => d.remove(), 800);
  }
  /** Painel de inventário (Tab): armas com raridade, equipamento, dinheiro e esquadrão. */
  inventory(show, v) {
    const el = $('inventory'); el.classList.toggle('hidden', !show); if (!show || !v) return;
    const { inv, cfg, squad, you, rarColor } = v;
    const slot = (k, label) => { const w = inv[k]; if (!w) return `<div class="inv-slot"><small>${label}</small>— vazio —</div>`;
      const def = cfg.weapons[w.id], R = cfg.rarity?.[w.rarity] ?? {};
      return `<div class="inv-slot" style="border-left-color:${rarColor[w.rarity] ?? '#888'}"><small>${label}${inv.active === k ? ' · EM MÃOS' : ''}</small><b>${def.name}</b> <span style="color:${rarColor[w.rarity]}">${R.label ?? w.rarity}</span><small>${w.mag} no pente · ${inv.ammo?.[def.ammo] ?? 0} reserva · dano ×${(R.damage ?? 1).toFixed(2)} · recuo ×${(R.recoil ?? 1).toFixed(2)}</small></div>`; };
    el.innerHTML = `<h3>INVENTÁRIO</h3><div class="inv-grid">${slot('primary', 'PRIMÁRIA')}${slot('secondary', 'SECUNDÁRIA')}
      <div class="inv-slot"><small>EQUIPAMENTO</small>🛡 ${inv.plates} placas · ✚ ${inv.heals} curas<br>💣 ${inv.lethal} granada · ☁ ${inv.tactical ?? 0} fumaça</div>
      <div class="inv-slot"><small>DINHEIRO</small><b style="color:var(--green)">$${inv.cash}</b><small>☠ ${you.stats?.kills ?? 0} eliminações</small></div></div>
      <h3 style="margin-top:12px">ESQUADRÃO</h3>${squad.map(m => `<div class="inv-slot" style="margin-top:4px"><b>${m.name}</b> <small>${STATE[m.state] ?? m.state}</small></div>`).join('') || '<small>sozinho</small>'}`;
  }
  /** Tiro local: abre a cruz e dá um tranco no contador. */
  fired() { this.bloom = Math.min(18, (this.bloom ?? 0) + 5); this.magKick = performance.now() + 60; }
  /** Banner de eliminação no centro da tela. */
  killBanner(name, { head = false, finisher = false } = {}) {
    const el = $('killBanner'); el.innerHTML = `<i>☠</i><div><b>${finisher ? 'FINALIZADO' : head ? 'TIRO NA CABEÇA' : 'ELIMINADO'}</b><span>${name}</span></div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  shotPing(x, z) { this.shots.push({ x, z, until: performance.now() + 1500 }); }

  buildCompass() {
    const labels = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    let html = '';
    for (let k = -360; k <= 720; k += 15) {
      const d = ((k % 360) + 360) % 360;
      html += labels[d] ? `<span class="c" style="left:${k * PX_PER_DEG}px">${labels[d]}</span>` : `<span style="left:${k * PX_PER_DEG}px">${d}</span>`;
      html += `<span class="t" style="left:${(k + 7.5) * PX_PER_DEG}px"></span>`;
    }
    $('compassStrip').innerHTML = html + '<span class="mk" id="mkZone" style="color:#ff8a2a">▼ZONA</span><span class="mk" id="mkContract" style="color:#e8b13a">◆</span>';
  }

  /** Atualização por frame. `view` = { snap, cfg, yaw, pos, lootNear, prompt, stations, boards, spectatingName, weaponDefs } */
  update(v) {
    const s = v.snap; if (!s) return;
    const y = s.you, now = performance.now();
    // topo
    $('topright').innerHTML = `<span>👤 <b>${s.match.alive}</b></span><span>👥 <b>${s.match.squadsLeft}</b></span><span>☠ <b>${y.stats.kills}</b></span>`;
    const z = s.zone, zi = y.zone, mm = Math.floor(Math.max(0, z.t) / 60), ss = String(Math.ceil(Math.max(0, z.t)) % 60).padStart(2, '0');
    const bearing = ((zi.bearing * 180 / Math.PI) + 360) % 360;
    $('zoneInfo').innerHTML = `<div>ZONA ${z.phase + 1}/${z.total} · ${z.state === 'waiting' ? 'fecha em' : z.state === 'closing' ? 'FECHANDO' : ''} <b>${mm}:${ss}</b> · ${z.dps} dano/s</div>
      <div>${zi.outside > 0 ? `<b>FORA DA ZONA · ${Math.round(zi.outside)} m ➜ ${Math.round(bearing)}°</b>` : `<span class="ok">DENTRO DA ZONA</span> · borda a ${Math.round(-zi.outside)} m`}</div>
      <div>RESSURGIMENTO <span class="${s.match.resurgence ? 'ok' : 'off'}">${s.match.resurgence ? 'ATIVO' : 'DESATIVADO'}</span>${y.radar ? ' · <span class="off">📡 RADAR</span>' : ''}</div>`;
    // bússola
    const hd = ((-v.yaw * 180 / Math.PI) % 360 + 360) % 360;
    $('compassStrip').style.transform = `translateX(${260 - hd * PX_PER_DEG}px)`;
    const place = (id, tx, tz) => { const el = $(id); if (tx === undefined) { el.style.display = 'none'; return; } el.style.display = '';
      let a = ((Math.atan2(tx - v.pos.x, -(tz - v.pos.z)) * 180 / Math.PI) + 360) % 360; if (a - hd > 180) a -= 360; if (hd - a > 180) a += 360; el.style.left = a * PX_PER_DEG + 'px'; };
    place('mkZone', z.to.x, z.to.z);
    const cpt = y.contract && (y.contract.area ?? y.contract.cache ?? y.contract.lastSeen); place('mkContract', cpt?.x, cpt?.z);
    // killfeed
    const kf = this.feed.filter(f => now - f.at < 7000).map(f => `<div class="${f.me ? 'me' : ''} ${now - f.at < 250 ? 'new' : ''} ${now - f.at > 6500 ? 'out' : ''}">${f.text}</div>`).join('');
    if (kf !== this._kf) { $('killfeed').innerHTML = kf; this._kf = kf; }
    // squad + eu — rastro de dano: a barra fantasma segura 0,4 s e desce devagar
    const inv = y.inv, cfgH = v.cfg.health;
    if (this.hpGhost === undefined || y.hp > this.hpGhost) { this.hpGhost = y.hp; this.hpHold = now; }
    else if (y.hp < this.lastHp) this.hpHold = now + 400;
    if (now > this.hpHold) this.hpGhost = Math.max(y.hp, this.hpGhost - (now - (this.lastHud ?? now)) * 0.06);
    this.lastHp = y.hp; this.lastHud = now;
    const plates = [0, 1, 2].map(i => `<i style="--f:${Math.max(0, Math.min(1, (y.ar - i * cfgH.plates.hpPerPlate) / cfgH.plates.hpPerPlate)) * 100}%"></i>`).join('');
    $('squad').innerHTML = s.squad.map(m => `<div class="sq"><span class="n st-${m.state}">${m.name}${m.connected ? '' : ' ⚠'}</span><span class="r st-${m.state}">${STATE[m.state] ?? m.state}${m.respawnIn != null ? ` ${m.respawnIn}s` : ''}${m.bleed != null ? ` ♥${m.bleed}` : ''} · ${m.dist} m</span>
      ${['alive', 'freefall', 'parachute'].includes(m.state) ? `<div class="bars">${[0, 1, 2].map(i => `<i style="--f:${Math.max(0, Math.min(1, (m.armor - i * 50) / 50)) * 100}%"></i>`).join('')}</div><div class="hp"><i style="width:${m.hp}%"></i></div>` : ''}</div>`).join('')
      + `<div class="sq me"><span class="n">${v.myName}</span><span class="r cash">$${inv?.cash ?? 0}</span>
      <div class="bars">${plates}</div><div class="hp ${y.hp < 35 && y.s === 'alive' ? 'low' : ''}"><b style="width:${this.hpGhost}%"></b><i style="width:${Math.max(0, y.hp)}%"></i></div><div class="stam"><i style="width:${y.stam}%"></i></div></div>`;
    // arma
    if (inv) {
      const w = inv[inv.active], def = w && v.cfg.weapons[w.id], other = inv[inv.active === 'primary' ? 'secondary' : 'primary'];
      const R = w && v.cfg.rarity?.[w.rarity], rc = RAR[w?.rarity] ?? '#bbb', res = def ? inv.ammo[def.ammo] : 0, max = def ? Math.round(def.mag * (R?.mag ?? 1)) : 1;
      const low = w && w.mag <= max * 0.25, empty = w && w.mag === 0 && res === 0;
      $('weapon').innerHTML = `<div class="inv"><span>🛡 ${inv.plates}</span><span>✚ ${inv.heals}</span><span>💣 ${inv.lethal}</span><span>☁ ${inv.tactical ?? 0}</span></div>
        <div class="mag ${low ? 'low' : ''} ${this.magKick > now ? 'kick' : ''}">${w?.mag ?? 0}<span class="res">/ ${res}</span></div>
        <div class="magbar"><i style="width:${Math.min(100, (w?.mag ?? 0) / max * 100)}%;background:${low ? '#ff5050' : rc}"></i></div>
        <div class="wn" style="border-right:3px solid ${rc}"><span style="color:${rc}">${R?.label ?? ''}</span> ${def?.name ?? '—'}</div><div class="other">${other ? v.cfg.weapons[other.id]?.name : '— slot vazio —'}</div>
        ${empty ? '<div class="warnAmmo">SEM MUNIÇÃO</div>' : low && y.action?.type !== 'reload' ? '<div class="warnAmmo">[R] RECARREGUE</div>' : ''}`;
    }
    // ponto vermelho do ADS e abertura da cruz ao atirar
    $('adsDot').classList.toggle('on', !!v.ads && !v.sniperScope);
    this.bloom = Math.max(0, (this.bloom ?? 0) - (now - (this.lastBloom ?? now)) * 0.02); this.lastBloom = now;
    $('crosshair').style.setProperty('--s', `${Math.round((v.spread ?? 6) + this.bloom)}px`);
    // ação com tempo
    const ab = $('actionBar');
    if (y.action) { ab.classList.remove('hidden'); ab.firstElementChild.style.width = `${(1 - y.action.left / y.action.total) * 100}%`; ab.lastElementChild.textContent = { reload: 'RECARREGANDO', plate: 'APLICANDO PLACA', heal: 'CURANDO', revive: 'REVIVENDO' }[y.action.type] ?? y.action.type; }
    else ab.classList.add('hidden');
    // contrato
    const k = y.contract, ce = $('contract');
    if (k) { ce.classList.remove('hidden'); const desc = { hunt: `Elimine <b>${k.target}</b> (última posição marcada)`, scavenger: `Encontre o esconderijo ${k.progress + 1}/${k.goal}`, capture: `Domine a área ${k.contested ? '<b style="color:#ff5050">CONTESTADA</b>' : ''}`, survive: 'Mantenha o squad vivo', collect: `Colete inteligência ${k.progress}/${k.goal}` }[k.type];
      ce.innerHTML = `<h4>CONTRATO · ${k.name.toUpperCase()}</h4><div>${desc}</div><div class="muted">${k.timeLeft}s restantes</div>${k.goal > 1 ? `<div class="bar"><i style="width:${Math.min(100, k.progress / k.goal * 100)}%"></i></div>` : ''}`; }
    else ce.classList.add('hidden');
    // respawn / espectador
    const rs = $('respawn');
    if (y.s === 'awaiting') { rs.className = ''; rs.innerHTML = `<div>RETORNO EM</div><div class="big">${Math.ceil(y.respawnIn)}s</div><div class="muted">${v.spectatingName ? `assistindo ${v.spectatingName} · [ ] trocar` : ''} · aliados vivos aceleram · abates do squad descontam</div>`; }
    else if (y.s === 'eliminated') { rs.className = 'final'; rs.innerHTML = `<div class="big">ELIMINADO</div><div class="muted">${v.spectatingName ? `espectador: ${v.spectatingName} · [ ] trocar` : 'aguarde o fim da partida'}${s.match.resurgence ? ' · um aliado pode te trazer de volta na estação' : ''}</div>`; }
    else rs.className = 'hidden';
    // centro / prompt
    let msg = now < this.center.until ? this.center.text : '';
    if (y.s === 'aircraft') msg = 'NA AERONAVE — ESPAÇO PARA SALTAR';
    else if (y.s === 'downed') msg = `ABATIDO — ♥ ${y.bleed}`;
    else if (y.s === 'freefall' && !msg) msg = `QUEDA LIVRE · ${Math.round(y.y)} m · Espaço abre o paraquedas`;
    $('center').textContent = msg;
    $('toast').textContent = now < this.toast.until ? this.toast.text : '';
    const pr = $('prompt'); pr.style.display = v.prompt ? 'block' : 'none'; pr.innerHTML = v.prompt ?? '';
    // mira / hitmarker / direção do dano
    $('crosshair').style.opacity = v.hideCrosshair ? 0 : 1;
    if (now > this.hitT) $('hitmarker').style.opacity = 0;
    this.dirs = this.dirs.filter(d => d.until > now);
    $('dmgDirs').innerHTML = this.dirs.map(d => `<i style="transform:rotate(${(d.angle + v.yaw) * -180 / Math.PI}deg);opacity:${(d.until - now) / 700}"></i>`).join('');
    $('scope').classList.toggle('hidden', !v.sniperScope);
    // mapas
    this.shots = this.shots.filter(p => p.until > now);
    this.drawMap(this.mm, 220, v, v.pos.x, v.pos.z, 1.25, true);
    if (!$('bigmap').classList.contains('hidden')) this.drawMap(this.bm, this.bm.canvas.width, v, 0, 0, this.bm.canvas.width / (v.mapView.size * 1.08), false);
    $('netStatus').textContent = v.netText ?? '';
  }

  drawMap(ctx, size, v, cx, cz, scale, rotate) {
    const s = v.snap, map = v.mapView;
    ctx.save(); ctx.fillStyle = '#23566b'; ctx.fillRect(0, 0, size, size); ctx.translate(size / 2, size / 2);
    if (rotate) ctx.rotate(v.yaw); ctx.scale(scale, scale); ctx.translate(-cx, -cz);
    const h = map.size / 2; ctx.fillStyle = '#c8b286'; ctx.fillRect(-h - 12, -h - 12, map.size + 24, map.size + 24); ctx.fillStyle = '#5f6040'; ctx.fillRect(-h, -h, map.size, map.size);
    const bg = this.mapImage(v.geo, map.size); ctx.drawImage(bg, -h, -h, map.size, map.size);
    const z = s.zone; ctx.fillStyle = 'rgba(255,100,0,.38)'; ctx.beginPath(); ctx.rect(-h * 3, -h * 3, map.size * 3, map.size * 3); ctx.arc(z.x, z.z, Math.max(0.1, z.r), 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / scale; ctx.setLineDash([6 / scale, 4 / scale]); ctx.beginPath(); ctx.arc(z.to.x, z.to.z, Math.max(0.1, z.to.r), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (!rotate) { ctx.fillStyle = '#fff'; ctx.font = `bold ${12 / scale}px sans-serif`; ctx.textAlign = 'center'; for (const p of map.pois) ctx.fillText(p.name.toUpperCase(), p.x, p.z); }
    const dot = (x, z, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, z, r / scale, 0, 7); ctx.fill(); };
    for (const st of v.stations ?? []) { ctx.fillStyle = '#7cff6b'; ctx.fillRect(st.x - 4 / scale, st.z - 4 / scale, 8 / scale, 8 / scale); }
    for (const b of v.boards?.values() ?? []) if (!b.taken) dot(b.x, b.z, 3, '#e8b13a');
    const k = s.you.contract, kp = k && (k.area ?? k.cache ?? k.lastSeen);
    if (kp) { ctx.strokeStyle = '#e8b13a'; ctx.lineWidth = 2 / scale; ctx.beginPath(); ctx.arc(kp.x, kp.z, Math.max(5 / scale, k.area?.r ?? (k.lastSeen ? 15 : 3)), 0, 7); ctx.stroke(); }
    for (const p of this.shots) dot(p.x, p.z, 3.5, '#ff2b2b');
    for (const o of v.others) { if (o.a) dot(o.x, o.z, 4, o.s === 'downed' ? '#ffb13a' : '#7cff6b'); else if (o.rv) dot(o.x, o.z, 3.5, '#ff4a4a'); }
    ctx.translate(v.pos.x, v.pos.z); ctx.rotate(-v.yaw); ctx.fillStyle = '#e8b13a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / scale;
    ctx.beginPath(); ctx.moveTo(0, -7 / scale); ctx.lineTo(5 / scale, 6 / scale); ctx.lineTo(0, 3 / scale); ctx.lineTo(-5 / scale, 6 / scale); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** Mapa de fundo pré-renderizado (terreno sombreado + construções), gerado uma vez por mapa. */
  mapImage(geo, size) {
    if (this.mapCache?.geo === geo) return this.mapCache.canvas;
    const N = 768, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), s = N / size, half = size / 2;
    const img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) / s, z = -half + (j + 0.5) / s, h = geo.terrainHeight(x, z), hx = geo.terrainHeight(x + 1.5, z) - h;
      const shade = Math.max(-30, Math.min(30, -hx * 18));
      let r = 95 + h * 3 + shade, gg = 98 + h * 2.4 + shade, b = 62 + h * 1.2 + shade;
      if (h < 0.6) { r = 196; gg = 178; b = 132; }
      const k = (j * N + i) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const col = { wall: '#d8cfbd', roof: '#9b948a', floor: '#bdb3a0', container: '#a4553f', cover: '#8d8260', rock: '#6f6b64', crate: '#8a6a3c', stair: '#bdb3a0' };
    for (const b of [...geo.boxes].sort((p, q) => p.y1 - q.y1)) {
      if (b.kind === 'trunk') { g.fillStyle = '#3d5a2a'; g.beginPath(); g.arc((b.minX + half) * s, (b.minZ + half) * s, 2.2 * s, 0, 7); g.fill(); continue; }
      g.fillStyle = col[b.kind] ?? '#a79d88'; g.fillRect((b.minX + half) * s, (b.minZ + half) * s, Math.max(1, (b.maxX - b.minX) * s), Math.max(1, (b.maxZ - b.minZ) * s));
    }
    this.mapCache = { geo, canvas: c };
    return c;
  }

  lobby(l, myId) {
    $('lobbyBox').classList.remove('hidden'); $('joinForm').classList.add('hidden');
    $('lobbyHead').innerHTML = `LOBBY · ${['', 'SOLO', 'DUO', 'TRIO', 'SQUAD'][l.squadSize]} · ${l.players.length} jogadores · ${l.state === 'countdown' ? `começa em <b>${l.countdown}s</b>` : 'aguardando jogadores'}`;
    $('lobbyList').innerHTML = l.players.map(p => `<div>${p.id === myId ? '★ ' : ''}${p.name}${p.bot ? ' <span class="muted">bot</span>' : ''}${p.party ? ` <span class="muted">[${p.party}]</span>` : ''}</div>`).join('');
  }

  shop(open, station, cfg, cash, mates) {
    const el = $('shop'); el.classList.toggle('hidden', !open); if (!open) return;
    const items = Object.entries(cfg.stations.catalog);
    el.innerHTML = `<h3>ESTAÇÃO DE COMPRA</h3><div class="muted">Saldo: $${cash} · clique para comprar · B fecha</div>` + items.map(([id, it]) => {
      const dead = mates.filter(m => ['awaiting', 'eliminated'].includes(m.state));
      if (id === 'buyback') return dead.length ? dead.map(m => `<div class="it ${cash < it.price ? 'no' : ''}" data-item="buyback" data-target="${m.id}"><span>${it.name}: ${m.name}<small>${it.desc}</small></span><b>$${it.price}</b></div>`).join('') : `<div class="it no"><span>${it.name}<small>nenhum aliado fora da partida</small></span><b>$${it.price}</b></div>`;
      return `<div class="it ${cash < it.price ? 'no' : ''}" data-item="${id}"><span>${it.name}<small>${it.desc}</small></span><b>$${it.price}</b></div>`;
    }).join('');
    el.dataset.station = station.id;
  }

  scoreboard(show, results) {
    const el = $('scoreboard'); el.classList.toggle('hidden', !show); if (!show) return;
    el.innerHTML = `<b>PLACAR</b><table>${results.map(r => `<tr><td>${r.name}</td><td>☠ ${r.kills}</td><td>${STATE[r.state] ?? ''}</td></tr>`).join('')}</table>`;
  }

  end(e, myId, mySquad) {
    const me = e.results.find(r => r.id === myId), won = e.winnerSquad && e.winnerSquad === mySquad;
    $('end').classList.remove('hidden'); $('endTitle').textContent = won ? 'VITÓRIA!' : `#${me?.placement ?? '?'} COLOCAÇÃO`; $('endTitle').style.color = won ? '#e8b13a' : '#fff';
    const f = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('endStats').innerHTML = (me ? `<div class="stats"><div><b>${me.placement}º</b>posição</div><div><b>${me.kills}</b>eliminações</div><div><b>${me.damage}</b>dano causado</div><div><b>${f(me.survived)}</b>tempo sobrevivido</div><div><b>${me.contracts}</b>contratos</div><div><b>$${me.cash}</b>dinheiro obtido</div></div>` : '')
      + `<table style="margin-top:14px"><tr><th>#</th><th>Jogador</th><th>Abates</th><th>Dano</th><th>Tempo</th><th>Contratos</th><th>$</th></tr>${e.results.slice(0, 12).map(r => `<tr style="${r.id === myId ? 'color:#e8b13a' : ''}"><td>${r.placement}</td><td>${r.name}</td><td>${r.kills}</td><td>${r.damage}</td><td>${f(r.survived)}</td><td>${r.contracts}</td><td>${r.cash}</td></tr>`).join('')}</table>`;
  }
  hideEnd() { $('end').classList.add('hidden'); }
}
export { RAR };
