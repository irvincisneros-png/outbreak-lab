// Outbreak Arcade: drawing. Reads wave state from logic.js, never changes it.
(function () {
  'use strict';
  const { HEROES, HERO_ANIM, ZOMBIE_ANIM, SURVIVOR_ANIM, WAVE, heroFrame } = window.ZW;
  const CELL = 384;
  const IMG = {};
  const SHEETS = {
    warrior: ['sprites/cp-warrior-move.webp', 'sprites/cp-warrior-combat.webp'],
    mage: ['sprites/mage-move.webp', 'sprites/mage-combat.webp'],
    paladin: ['sprites/paladin-move.webp', 'sprites/paladin-combat.webp'],
    archer: ['sprites/archer-move.webp', 'sprites/archer-combat.webp'],
  };
  const OTHER = { zombie: 'sprites/zombie.webp', survivor: 'sprites/survivor.webp',
                  far: 'sprites/bg-far.webp', mid: 'sprites/bg-mid.webp', street: 'sprites/bg-street.webp' };

  function load(src) {
    return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  async function loadAll(onProgress) {
    const list = [];
    for (const k in SHEETS) { list.push([k + ':move', SHEETS[k][0]], [k + ':combat', SHEETS[k][1]]); }
    for (const k in OTHER) list.push([k, OTHER[k]]);
    let n = 0;
    await Promise.all(list.map(([key, src]) => load(src).then(i => { IMG[key] = i; onProgress && onProgress(++n / list.length); })));
    // colour variants so a crowd is not a row of clones (made once, at load)
    // survivors: only small tone shifts, so skin stays human (big hue shifts made them look like zombies)
    IMG.survivorV = [IMG.survivor, tint(IMG.survivor, 'hue-rotate(-14deg) brightness(1.12)'), tint(IMG.survivor, 'sepia(0.25) brightness(0.92)'),
                     tint(IMG.survivor, 'hue-rotate(12deg) saturate(1.25) brightness(1.05)')];
    IMG.zombieV = [IMG.zombie, tint(IMG.zombie, 'hue-rotate(-25deg) brightness(0.9)'), tint(IMG.zombie, 'hue-rotate(30deg) saturate(0.8)')];
  }
  function tint(img, filter) {
    if (!img) return img;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.filter = filter; x.drawImage(img, 0, 0);
    return c;
  }

  function sprite(ctx, img, col, row, x, y, size, face, alpha) {
    if (!img) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(img, col * CELL, row * CELL, CELL, CELL, -size / 2, -size + size * 12 / CELL, size, size);
    ctx.restore();
  }

  // Tile an image horizontally with parallax. Odd tiles are mirrored to hide seams.
  function tile(ctx, img, par, cam, y, h, W) {
    if (!img) return false;
    const w = h * img.width / img.height;
    let start = Math.floor(cam * par / w);
    for (let i = start; ; i++) {
      const x = i * w - cam * par;
      if (x > W) break;
      if (i % 2) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w, h); ctx.restore(); }
      else ctx.drawImage(img, x, y, w, h);
    }
    return true;
  }

  // simple seeded variation per zombie so the crowd does not look cloned
  let vSeed = 0;
  function variant(e) { if (e._v === undefined) e._v = (Math.abs(Math.sin(e.x * 12.9898 + ++vSeed * 78.233)) * 43758.5453) % 1; return e._v; }

  function draw(ctx, st, view) {
    const { W, H } = view;
    const gy = Math.round(H * 0.83);                    // ground line
    const size = Math.min(560, H * 0.62);               // sprite cell size on screen
    const h = st.hero;
    view.cam += ((h.x - W * 0.38) - view.cam) * Math.min(1, view.dt * 6);
    view.cam = Math.max(0, Math.min(WAVE.length - W, view.cam));
    const cam = view.cam;

    // sky / far / mid
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#120a24'); sky.addColorStop(0.6, '#3a1640'); sky.addColorStop(1, '#a8406a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    if (!tile(ctx, IMG.far, 0.15, cam, 0, gy + 20, W)) {}
    tile(ctx, IMG.mid, 0.45, cam, gy - H * 0.62 + 10, H * 0.62, W);
    // street
    if (!tile(ctx, IMG.street, 1, cam, gy - 18, H - gy + 18 + 40, W)) {
      ctx.fillStyle = '#1d1c24'; ctx.fillRect(0, gy, W, H - gy);
    }
    // wave edges: barricades so students know where the street ends
    for (const ex of [0, WAVE.length]) { const sx = ex - cam; if (sx > -80 && sx < W + 80) {
      ctx.fillStyle = '#ffb020'; for (let k = 0; k < 4; k++) { ctx.fillRect(sx - 30, gy - 120 + k * 28, 60, 12); } } }

    // walls (warrior)
    for (const w of st.walls) {
      // no-contact zone on the ground
      const za = Math.min(1, w.t / 0.3) * (w.t > 5.5 ? (6 - w.t) / 0.5 : 1);
      const zx = w.x - cam, zr = window.ZW.WALL_ZONE;
      const zg = ctx.createLinearGradient(zx - zr, 0, zx + zr, 0);
      zg.addColorStop(0, 'rgba(34,255,255,0)'); zg.addColorStop(0.5, `rgba(34,255,255,${0.22 * za})`); zg.addColorStop(1, 'rgba(34,255,255,0)');
      ctx.fillStyle = zg; ctx.fillRect(zx - zr, gy - 8, zr * 2, 26);
      const a = w.t < 0.15 ? w.t / 0.15 : w.t > 5.5 ? (6 - w.t) / 0.5 : 1;
      const sx = w.x - cam, wh = H * 0.36 * Math.min(1, w.t / 0.15);
      ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = '#2ff'; ctx.shadowBlur = 30;
      const g = ctx.createLinearGradient(0, gy - wh, 0, gy); g.addColorStop(0, 'rgba(34,255,255,0)'); g.addColorStop(1, 'rgba(34,255,255,0.85)');
      ctx.fillStyle = g; ctx.fillRect(sx - 16, gy - wh, 32, wh);
      ctx.strokeStyle = '#bff'; ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) { const yy = gy - ((w.t * 160 + k * wh / 6) % wh); ctx.beginPath(); ctx.moveTo(sx - 22, yy); ctx.lineTo(sx + 22, yy); ctx.stroke(); }
      ctx.restore();
    }

    // shadows
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const shadow = (x, r) => { ctx.beginPath(); ctx.ellipse(x - cam, gy + 2, r, r * 0.18, 0, 0, 7); ctx.fill(); };
    st.survivors.forEach(s => { if (!s.left && s.anim !== 'flee') shadow(s.x, size * 0.12); });
    st.zombies.forEach(z => { if (!z.dead) shadow(z.x, size * 0.13); });
    // faint sickly glow under zombies so they read apart from survivors at a glance
    for (const z of st.zombies) { if (z.dead || z.anim === 'cure') continue;
      const zx = z.x - cam, r = size * (z.hub ? 0.2 : 0.15);
      const g = ctx.createRadialGradient(zx, gy, 0, zx, gy, r); g.addColorStop(0, z.hub ? 'rgba(255,51,204,0.45)' : 'rgba(150,255,100,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(zx, gy, r, r * 0.25, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';

    // survivors
    const ss = size * 0.8;
    for (const s of st.survivors) {
      if (s.left) continue;
      const [row, n, fps, loop] = SURVIVOR_ANIM[s.anim];
      const f = loop ? Math.floor(s.t * fps) % n : Math.min(Math.floor(s.t * fps), n - 1);
      const sv = Math.floor(variant(s) * 4), sz = ss * (0.92 + (variant(s) * 7 % 1) * 0.12);
      const fade = s.anim === 'flee' ? Math.max(0, Math.min(1, (2.2 - s.t) / 0.6)) : 1;
      sprite(ctx, (IMG.survivorV || [])[sv] || IMG.survivor, f, row, s.x - cam, gy, sz, s.face, fade);
      if (s.immune && !s.cured) {
        ctx.save(); ctx.strokeStyle = '#b8f'; ctx.shadowColor = '#b8f'; ctx.shadowBlur = 12; ctx.lineWidth = 2; ctx.globalAlpha = 0.55 + 0.2 * Math.sin(st.t * 4 + s.x);
        ctx.beginPath(); ctx.ellipse(s.x - cam, gy - ss * 0.3, ss * 0.16, ss * 0.33, 0, 0, 7); ctx.stroke(); ctx.restore();
      }
    }
    // zombies
    for (const z of st.zombies) {
      if (z.dead) continue;
      const [row, n, fps, loop] = ZOMBIE_ANIM[z.anim];
      const f = loop ? Math.floor(z.t * fps) % n : Math.min(Math.floor(z.t * fps), n - 1);
      const v = variant(z), zs = size * (z.hub ? 0.98 : 0.86 + v * 0.08);
      const zimg = (IMG.zombieV || [])[Math.floor(v * 3)] || IMG.zombie;
      sprite(ctx, zimg, f, row, z.x - cam, gy, zs, z.face);
      if (z.anim === 'flinch' && f < 2) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; sprite(ctx, zimg, f, row, z.x - cam, gy, zs, z.face, 0.5); ctx.restore(); }
      if (z.hub) {
        ctx.save(); ctx.font = '700 13px "Chakra Petch", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#f3c'; ctx.shadowColor = '#f3c'; ctx.shadowBlur = 10;
        ctx.fillText('HUB', z.x - cam, gy - zs * 0.66); ctx.restore();
      }
    }

    // hero
    if (st.heroActive) {
      const HD = HEROES[st.heroKey];
      const [sheet, row0, , , , cols] = HERO_ANIM[h.anim];
      const f = heroFrame(h);
      const img = IMG[st.heroKey + ':' + sheet];
      const blink = h.inv > 0 && Math.floor(h.inv * 14) % 2;
      const sh = Math.max(0.3, 1 + h.y / 400);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(h.x - cam, gy + 2, size * 0.15 * sh, size * 0.028 * sh, 0, 0, 7); ctx.fill();
      // hero marker
      ctx.save(); ctx.fillStyle = HD.color; ctx.shadowColor = HD.color; ctx.shadowBlur = 10;
      const my = gy + h.y - size * 0.62 - 6 + Math.sin(st.t * 5) * 3;
      ctx.beginPath(); ctx.moveTo(h.x - cam - 8, my); ctx.lineTo(h.x - cam + 8, my); ctx.lineTo(h.x - cam, my + 10); ctx.fill(); ctx.restore();
      if (!blink) sprite(ctx, img, f % cols, row0 + Math.floor(f / cols), h.x - cam, gy + h.y, size, h.face);
    }

    // fx
    for (const e of st.fx) {
      const life = e.life || 0.9, k = e.t / life;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.strokeStyle = e.color; ctx.shadowColor = e.color; ctx.shadowBlur = 25;
      if (e.type === 'dome') { ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(e.x - cam, gy, e.r * Math.min(1, k * 3), Math.PI, 0); ctx.stroke();
        ctx.globalAlpha *= 0.15; ctx.fillStyle = e.color; ctx.fill(); }
      else if (e.type === 'ring') { ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(e.x - cam, gy - 8, e.r * k, 30 + 40 * k, 0, 0, 7); ctx.stroke(); }
      else if (e.type === 'slash') { ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(e.x - cam, gy + e.y + 40, 70, e.face > 0 ? -1.2 : Math.PI - 0.6, e.face > 0 ? 0.6 : Math.PI + 1.2); ctx.stroke(); }
      ctx.restore();
    }
    // shots
    for (const s of st.shots) {
      if (s.delay > 0) continue;
      const sx = s.x - cam, sy = gy + s.y;
      ctx.save(); ctx.shadowColor = s.color; ctx.shadowBlur = 16; ctx.fillStyle = s.color; ctx.strokeStyle = s.color;
      if (s.kind === 'bolt') { ctx.beginPath(); ctx.arc(sx, sy, 10, 0, 7); ctx.fill(); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(sx - Math.sign(s.vx) * 16, sy, 7, 0, 7); ctx.fill(); }
      else { ctx.translate(sx, sy); ctx.rotate(Math.atan2(s.vy, s.vx)); ctx.fillRect(-28, -2, 56, 4); ctx.beginPath(); ctx.moveTo(28, -6); ctx.lineTo(40, 0); ctx.lineTo(28, 6); ctx.fill(); }
      ctx.restore();
    }

    // neon haze over everything for mood
    const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, W * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,4,20,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // S/I/R line graph used live and on the debrief card
  function graph(ctx, w, h, runs, opts = {}) {
    ctx.clearRect(0, 0, w, h);
    const max = opts.max || Math.max(5, ...runs.flatMap(r => r.history.map(p => Math.max(p.s, p.i, p.r))));
    const T = opts.T || WAVE.duration;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const y = h - k * h / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (const run of runs) {
      for (const [key, col] of run.lines) {
        ctx.strokeStyle = col; ctx.lineWidth = run.width || 3; ctx.setLineDash(run.dash || []);
        ctx.beginPath();
        run.history.forEach((p, i) => { const x = p.t / T * w, y = h - 3 - p[key] / max * (h - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // Hero portrait for the select screen: first idle frame cropped from the sheet
  function portrait(canvas, heroKey) {
    const img = IMG[heroKey + ':move']; if (!img) return;
    const c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height);
    const crop = CELL * 0.62;
    c.drawImage(img, (CELL - crop) / 2, CELL - crop - 8, crop, crop, 0, 0, canvas.width, canvas.height);
  }

  window.ZR = { loadAll, draw, graph, portrait, IMG };
})();
