// Outbreak Arcade: wave logic. No DOM, no drawing, so it can run headless
// (for the "no hero" comparison run and for tests).
(function (root) {
  'use strict';

  const WAVE = {
    length: 4400,          // world width in px
    duration: 90,          // seconds per wave
    survivors: 24,
    zombies: 2,            // starting infected
    arrivals: 6,           // infected travellers who walk in from the edges during the wave (two are hubs)
    firstArrival: 8, arrivalGap: 11,
    catchChance: 0.35,     // chance a zombie grab infects a survivor
    sickTime: 45,          // seconds before a zombie recovers on its own (days infectious)
    zombieSpeed: 70, hubSpeed: 100,
    zombieCool: 1.8, hubCool: 0.9,   // seconds between grabs (contacts)
    sight: 700,
  };

  const HEROES = {
    warrior: { name: 'Warrior', special: 'Shock Wall', variable: 'Contacts per day',
      blurb: 'Slams down an energy wall. Zombies near it are slowed and cannot grab anyone, so they make fewer contacts.',
      attack: { kind: 'melee', range: 150, frame: 1, dmg: 1 }, color: '#2ff', cooldown: 7 },
    mage: { name: 'Mage', special: 'Nano Ward', variable: '% vaccinated',
      blurb: 'Casts a nano-shield over nearby survivors. Shielded survivors cannot catch the virus, like a vaccine.',
      attack: { kind: 'bolt', speed: 900, frame: 1, dmg: 1 }, color: '#b8f', cooldown: 7 },
    paladin: { name: 'Paladin', special: 'Cure Pulse', variable: 'Days infectious',
      blurb: 'Releases a healing pulse that cures nearby zombies straight away, so they stay infectious for less time.',
      attack: { kind: 'melee', range: 140, frame: 1, dmg: 1 }, color: '#cf6', cooldown: 12 },
    archer: { name: 'Archer', special: 'Tracker Volley', variable: 'Hubs first',
      blurb: 'Fires three homing arrows at the hub zombies first. Hubs move faster and grab more often, so they spread it most.',
      attack: { kind: 'arrow', speed: 1400, frame: 2, dmg: 1 }, color: '#f3c', cooldown: 7 },
  };
  const ORDER = ['warrior', 'mage', 'paladin', 'archer'];
  const WALL_ZONE = 260;   // Shock Wall: zombies this close to the wall cannot grab anyone

  // [sheet, firstRow, frames, fps, loop, cols]
  const HERO_ANIM = {
    idle: ['move', 0, 6, 8, true, 6], run: ['move', 1, 6, 12, true, 6], jump: ['move', 2, 6, 0, false, 6],
    hit: ['move', 3, 6, 14, false, 6], attack: ['combat', 0, 4, 14, false, 4], special: ['combat', 1, 8, 11, false, 4],
  };
  // [row, frames, fps, loop]
  const ZOMBIE_ANIM = { walk: [0, 6, 7, true], lunge: [1, 6, 12, false], flinch: [2, 6, 16, false], cure: [3, 6, 9, false] };
  const SURVIVOR_ANIM = { idle: [0, 6, 7, true], walk: [1, 6, 9, true], wave: [2, 6, 9, false], flee: [1, 6, 16, true] };

  function makeRng(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  function createWave(seed, heroKey, heroActive = true) {
    const rng = makeRng(seed);
    const st = {
      t: 0, done: false, heroKey, heroActive, rng,
      hero: { x: 260, y: 0, vy: 0, face: 1, anim: 'idle', t: 0, ground: true, landT: 0, hp: 5, inv: 0,
              fired: false, cd: 0, down: 0 },
      zombies: [], survivors: [], walls: [], shots: [], fx: [], events: [],
      stats: { cured: 0, naturalCures: 0, infections: 0, peak: 0, vaccinated: 0, hubsCured: 0, wallBlocks: 0 },
      history: [],
    };
    for (let i = 0; i < WAVE.survivors; i++)
      st.survivors.push(mkSurvivor(st, 600 + (i / WAVE.survivors) * (WAVE.length - 800) + rng() * 120));
    const zx = [1700, 3200];
    for (let i = 0; i < WAVE.zombies; i++) st.zombies.push(mkZombie(st, zx[i], false));
    // arrival schedule is part of the seed, so every hero (and the no-hero model) faces the same outbreak
    st.arrivals = [];
    for (let i = 0; i < WAVE.arrivals; i++)
      st.arrivals.push({ t: WAVE.firstArrival + i * WAVE.arrivalGap + rng() * 4, side: rng() < 0.5 ? 0 : 1, hub: i === 1 || i === 4 });
    record(st);
    return st;
  }
  function mkZombie(st, x, hub) {
    return { x, face: -1, anim: 'walk', t: st.rng(), hp: hub ? 8 : 5, hub, cool: 0, sick: WAVE.sickTime * (0.8 + st.rng() * 0.4),
             wander: st.rng() < 0.5 ? 1 : -1, wanderT: 2 + st.rng() * 3, dead: false };
  }
  function mkSurvivor(st, x) {
    return { x, face: st.rng() < 0.5 ? 1 : -1, anim: 'idle', t: st.rng(), immune: false, cured: false, gone: false };
  }

  const infectedCount = st => st.zombies.filter(z => !z.dead).length;
  const healthyCount = st => st.survivors.filter(s => !s.cured && !s.gone).length;
  const townSize = () => WAVE.survivors + WAVE.zombies + WAVE.arrivals;
  function record(st) {
    const i = infectedCount(st);
    st.stats.peak = Math.max(st.stats.peak, i);
    st.history.push({ t: st.t, s: healthyCount(st), i, r: st.stats.cured + st.stats.naturalCures });
  }

  const heroLocked = h => h.anim === 'attack' || h.anim === 'special' || h.anim === 'hit';
  function setAnim(h, a) { if (h.anim !== a) { h.anim = a; h.t = 0; h.fired = false; } }

  function heroFrame(h) {
    const [, , n, fps, loop] = HERO_ANIM[h.anim];
    if (h.anim === 'jump') return h.ground ? 5 : h.vy < -500 ? 1 : h.vy < -120 ? 2 : h.vy < 200 ? 3 : 4;
    const f = Math.floor(h.t * fps);
    return loop ? f % n : Math.min(f, n - 1);
  }

  function hurtZombie(st, z, dmg, face) {
    if (z.dead || z.anim === 'cure') return;
    z.hp -= dmg; z.x += face * 30;
    if (z.hp <= 0) { z.anim = 'cure'; z.t = 0; z.byHero = true; }
    else { z.anim = 'flinch'; z.t = 0; }
  }

  // input: { left, right, jump, attack, special } (jump/attack/special are one-shot presses)
  function step(st, dt, input = {}) {
    if (st.done) return;
    st.t += dt;
    const W = WAVE, h = st.hero, HD = HEROES[st.heroKey];

    // ---- hero ----
    if (st.heroActive) {
      h.inv -= dt; h.cd = Math.max(0, h.cd - dt);
      if (input.jump && h.ground && !heroLocked(h)) { h.vy = -820; h.ground = false; setAnim(h, 'jump'); }
      if (input.attack && !heroLocked(h)) setAnim(h, 'attack');
      if (input.special && h.ground && !heroLocked(h) && h.cd <= 0) { setAnim(h, 'special'); h.cd = HD.cooldown; }
      if (!(heroLocked(h) && h.ground) && (input.left || input.right)) { h.face = input.right ? 1 : -1; h.x += h.face * 300 * dt; }
      h.vy += 2200 * dt; h.y += h.vy * dt;
      if (h.y >= 0) { if (!h.ground) h.landT = 0.1; h.y = 0; h.vy = 0; h.ground = true; }
      h.x = Math.max(60, Math.min(W.length - 60, h.x));
      h.t += dt;
      const [, , n, fps, loop] = HERO_ANIM[h.anim];
      if (!loop && h.anim !== 'jump' && Math.floor(h.t * fps) >= n) setAnim(h, 'idle');
      if (!heroLocked(h)) {
        if (!h.ground) setAnim(h, 'jump');
        else if (h.landT > 0) { h.landT -= dt; h.anim = 'jump'; }
        else setAnim(h, input.left || input.right ? 'run' : 'idle');
      }
      const f = heroFrame(h);
      if (h.anim === 'attack' && f >= HD.attack.frame && !h.fired) {
        h.fired = true;
        const a = HD.attack;
        if (a.kind === 'melee') {
          st.fx.push({ type: 'slash', x: h.x + h.face * 90, y: h.y - 150, face: h.face, t: 0, color: HD.color });
          for (const z of st.zombies) { const d = (z.x - h.x) * h.face; if (d > -20 && d < a.range && h.y > -160) hurtZombie(st, z, a.dmg, h.face); }
        } else st.shots.push({ kind: a.kind, x: h.x + h.face * 70, y: h.y - 150, vx: h.face * a.speed, vy: 0, life: 1.1, dmg: a.dmg, color: HD.color });
      }
      if (h.anim === 'special' && f >= 4 && !h.fired) { h.fired = true; special(st); }
    }

    // ---- infected travellers arrive ----
    while (st.arrivals.length && st.arrivals[0].t <= st.t) {
      const a = st.arrivals.shift();
      const z = mkZombie(st, a.side ? W.length - 30 : 30, a.hub); z.face = a.side ? -1 : 1; z.arrived = true;
      st.zombies.push(z); st.events.push(a.hub ? 'hub-arrives' : 'arrives');
    }

    // ---- shots ----
    for (const s of st.shots) {
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt;
      if (s.target) {
        const z = s.target;
        if (z.dead || z.anim === 'cure') { s.target = null; continue; }
        const dx = z.x - s.x, dy = -130 - s.y, d = Math.hypot(dx, dy) || 1;
        s.vx = s.vx * 0.88 + dx / d * 1500 * 0.12; s.vy = s.vy * 0.88 + dy / d * 1500 * 0.12;
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (d < 45) { hurtZombie(st, z, s.dmg, Math.sign(s.vx) || 1); s.life = 0; }
      } else {
        s.x += s.vx * dt; s.y += s.vy * dt;
        const z = st.zombies.find(z => !z.dead && z.anim !== 'cure' && Math.abs(z.x - s.x) < 40);
        if (z) { hurtZombie(st, z, s.dmg, Math.sign(s.vx)); s.life = 0; }
      }
    }
    st.shots = st.shots.filter(s => s.life > 0);

    // ---- walls ----
    for (const w of st.walls) w.t += dt;
    st.walls = st.walls.filter(w => w.t < 6);

    // ---- zombies ----
    for (const z of st.zombies) {
      if (z.dead) continue;
      z.t += dt; z.cool -= dt; z.sick -= dt;
      const [, n, fps] = ZOMBIE_ANIM[z.anim];
      if (z.anim === 'cure') {
        if (z.t * fps >= n) {
          z.dead = true;
          if (z.byHero) { st.stats.cured++; if (z.hub) st.stats.hubsCured++; } else st.stats.naturalCures++;
          const s = mkSurvivor(st, z.x); s.anim = 'wave'; s.t = 0; s.immune = true; s.cured = true; s.face = z.face;
          st.survivors.push(s);
        }
        continue;
      }
      if (z.sick <= 0) { z.anim = 'cure'; z.t = 0; z.byHero = false; continue; }
      if (z.anim === 'flinch' || z.anim === 'lunge') { if (z.t * fps >= n) { z.anim = 'walk'; z.t = 0; } continue; }
      // choose prey: nearest unprotected survivor, or the hero
      let prey = null, best = W.sight;
      for (const s of st.survivors) if (!s.immune && !s.gone && Math.abs(s.x - z.x) < best) { best = Math.abs(s.x - z.x); prey = s; }
      if (st.heroActive && Math.abs(h.x - z.x) < best) prey = h;
      let dir;
      if (prey) dir = Math.sign(prey.x - z.x) || z.face;
      else { z.wanderT -= dt; if (z.wanderT <= 0) { z.wander = -z.wander; z.wanderT = 2 + st.rng() * 3; } dir = z.wander; }
      z.face = dir;
      const blocked = st.walls.some(w => Math.sign(w.x - z.x) === dir && Math.abs(w.x - z.x) < 45);
      const zone = st.walls.some(w => Math.abs(w.x - z.x) < WALL_ZONE);   // inside the no-contact zone
      if (!blocked) z.x += dir * (z.hub ? W.hubSpeed : W.zombieSpeed) * (prey ? 1 : 0.4) * (zone ? 0.35 : 1) * dt;
      z.x = Math.max(20, Math.min(W.length - 20, z.x));
      if (prey && Math.abs(prey.x - z.x) < 70 && z.cool <= 0 && (blocked || zone)) { z.cool = 0.6; st.stats.wallBlocks++; }
      else if (prey && Math.abs(prey.x - z.x) < 70 && z.cool <= 0) {
        z.anim = 'lunge'; z.t = 0; z.cool = z.hub ? W.hubCool : W.zombieCool;
        if (prey === h) {
          if (h.inv <= 0 && h.y > -60) { h.hp--; h.inv = 1.2; h.anim = 'hit'; h.t = 0; h.fired = false; h.x -= z.face * -70;
            if (h.hp <= 0) { h.hp = 5; st.events.push('hero-down'); } }
        } else if (st.rng() < W.catchChance) {
          prey.gone = true; st.stats.infections++;
          const nz = mkZombie(st, prey.x, false); nz.anim = 'flinch'; nz.face = -z.face; st.zombies.push(nz);
        }
      }
    }
    st.survivors = st.survivors.filter(s => !s.gone);

    // ---- survivors ----
    for (const s of st.survivors) {
      s.t += dt;
      const [, n, fps] = SURVIVOR_ANIM[s.anim];
      if (s.left) continue;
      if (s.anim === 'wave') { if (s.t * fps >= n) { s.anim = 'flee'; s.t = 0; s.face = s.x < W.length / 2 ? -1 : 1; } continue; }
      if (s.anim === 'flee') {                     // cured people run off to the safe zone and leave the street
        s.x += s.face * 260 * dt;
        if (s.t > 2.2) s.left = true;
        continue;
      }
      let threat = null;
      if (!s.immune) for (const z of st.zombies) if (!z.dead && z.anim !== 'cure' && Math.abs(z.x - s.x) < 280) { threat = z; break; }
      if (threat) { if (s.anim !== 'walk') { s.anim = 'walk'; s.t = 0; } s.face = Math.sign(s.x - threat.x) || 1; s.x += s.face * 50 * dt; }
      else if (s.anim === 'walk') { s.anim = 'idle'; s.t = 0; }
      s.x = Math.max(20, Math.min(W.length - 20, s.x));
    }

    // keep a little personal space so crowds do not stack into one blob
    spread(st.survivors.filter(s => !s.gone && !s.cured), 55, dt);
    spread(st.zombies.filter(z => !z.dead), 48, dt);

    for (const e of st.fx) e.t += dt;
    st.fx = st.fx.filter(e => e.t < (e.life || 0.9));

    if (!st.history.length || st.t - st.history[st.history.length - 1].t >= 0.5) record(st);
    if (st.t >= W.duration) { st.done = true; record(st); }
  }

  function spread(list, minGap, dt) {
    const sorted = list.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - sorted[i - 1].x;
      if (gap < minGap) { const push = (minGap - gap) * 0.5 * Math.min(1, dt * 6); sorted[i].x += push; sorted[i - 1].x -= push; }
    }
  }

  function special(st) {
    const h = st.hero, k = st.heroKey;
    if (k === 'warrior') {
      const wx = h.x + h.face * 150;
      st.walls.push({ x: wx, t: 0 });
      st.fx.push({ type: 'ring', x: wx, r: 260, t: 0, life: 0.6, color: '#2ff' });
      for (const z of st.zombies) {               // shockwave: knock back and stun zombies in front of the wall
        const d = (z.x - h.x) * h.face;
        if (!z.dead && z.anim !== 'cure' && d > 0 && d < 420) { hurtZombie(st, z, 2, h.face); if (!z.dead && z.anim !== 'cure') z.x = Math.max(z.x * h.face, (wx + h.face * 140) * h.face) * h.face; }
      }
    }
    if (k === 'mage') {
      st.fx.push({ type: 'dome', x: h.x, r: 400, t: 0, life: 1, color: '#b8f' });
      for (const s of st.survivors) if (!s.immune && Math.abs(s.x - h.x) < 400) { s.immune = true; st.stats.vaccinated++; }
    }
    if (k === 'paladin') {
      st.fx.push({ type: 'ring', x: h.x, r: 380, t: 0, life: 1, color: '#cf6' });
      for (const z of st.zombies) if (!z.dead && z.anim !== 'cure' && Math.abs(z.x - h.x) < 380) { z.anim = 'cure'; z.t = 0; z.byHero = true; }
    }
    if (k === 'archer') {
      const live = st.zombies.filter(z => !z.dead && z.anim !== 'cure');
      live.sort((a, b) => (b.hub - a.hub) || Math.abs(a.x - h.x) - Math.abs(b.x - h.x));
      live.slice(0, 3).forEach((z, i) => st.shots.push({ kind: 'homing', target: z, x: h.x + h.face * 40, y: h.y - 170,
        vx: h.face * 300, vy: -500, life: 3, delay: i * 0.12, dmg: 3, color: '#f3c' }));
    }
  }

  // Run a whole wave instantly with no hero: the computer model of "what if nobody acted".
  function runBaseline(seed, heroKey) {
    const st = createWave(seed, heroKey, false);
    while (!st.done) step(st, 1 / 30);
    return st;
  }

  const api = { WALL_ZONE, WAVE, HEROES, ORDER, HERO_ANIM, ZOMBIE_ANIM, SURVIVOR_ANIM, createWave, step, runBaseline, heroFrame, infectedCount, healthyCount, townSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ZW = api;
})(typeof window !== 'undefined' ? window : globalThis);
