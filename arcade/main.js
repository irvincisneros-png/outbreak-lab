// Outbreak Arcade: screens, input and the game loop.
(function () {
  'use strict';
  const { HEROES, ORDER, WAVE, createWave, step, runBaseline, infectedCount, healthyCount, townSize } = window.ZW;
  const R = window.ZR;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const SEED = 20261116;                 // same starting outbreak for every hero = fair test
  const view = { W: 0, H: 0, cam: 0, dt: 0 };

  // ---- persistence (per browser tab; works without it) ----
  let best = {};
  try { best = JSON.parse(sessionStorage.getItem('arcade-best') || '{}'); } catch (e) { best = {}; }
  const saveBest = () => { try { sessionStorage.setItem('arcade-best', JSON.stringify(best)); } catch (e) { /* storage blocked */ } };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.W = innerWidth; view.H = innerHeight;
    canvas.width = view.W * dpr; canvas.height = view.H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
    $('hud').classList.toggle('on', id === null || id === 'pause');
    const first = id && $(id).querySelector('button.primary:not([disabled]), .hero, button');
    if (first) setTimeout(() => first.focus(), 30);
  }

  // ---- state ----
  let mode = 'menu';          // menu | play | paused
  let heroKey = 'warrior', prediction = null, baseline = null, wave = null;
  const input = { left: false, right: false, jump: false, attack: false, special: false };

  // ---- menu background: an idle wave with no hero, slowly panning ----
  let attract = createWave(SEED, 'warrior', false);

  // ---- hero select ----
  function buildSelect() {
    const box = $('heroes'); box.innerHTML = '';
    for (const k of ORDER) {
      const H = HEROES[k];
      const b = document.createElement('button'); b.className = 'hero'; b.style.setProperty('--hc', H.color);
      b.innerHTML = `<canvas width="220" height="220" aria-hidden="true"></canvas><span class="nm">${H.name}</span>
        <span class="sp">Special: ${H.special}</span><span class="var">Variable: ${H.variable}</span><span class="bl">${H.blurb}</span>
        <span class="done">${best[k] ? 'Best peak: ' + best[k].peak + ' (no hero: ' + best[k].base + ')' : ''}</span>`;
      b.setAttribute('aria-label', `${H.name}. Special ${H.special}, stands for ${H.variable}.`);
      b.onclick = () => pickHero(k);
      box.appendChild(b);
      R.portrait(b.querySelector('canvas'), k);
    }
    $('toResults').hidden = !Object.keys(best).length;
  }

  function pickHero(k) {
    heroKey = k; prediction = null;
    const H = HEROES[k];
    baseline = runBaseline(SEED, k);
    $('basePeak').textContent = baseline.stats.peak;
    $('townSize').textContent = townSize();
    $('pHero').textContent = H.name; $('pSpecial').textContent = H.special;
    $('pKey').textContent = `Special: ${H.special}. ${H.blurb}`;
    document.querySelectorAll('.choices button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('goBtn').disabled = true;
    show('predict');
  }
  document.querySelectorAll('.choices button').forEach(b => b.onclick = () => {
    prediction = b.dataset.p;
    document.querySelectorAll('.choices button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('goBtn').disabled = false; $('goBtn').focus();
  });

  // ---- wave ----
  function startWave() {
    wave = createWave(SEED, heroKey, true);
    view.cam = 0;
    const H = HEROES[heroKey];
    document.documentElement.style.setProperty('--hc', H.color);
    $('hudL').style.setProperty('--hc', H.color);
    $('hName').textContent = H.name; $('hSpName').textContent = H.special;
    toast('Cure the zombies, protect the survivors. More infected will arrive.');
    mode = 'play'; show(null);
  }
  let toastT = 0;
  function toast(msg) { $('toast').textContent = msg; $('toast').style.opacity = 1; toastT = 2.5; }

  function endWave() {
    mode = 'menu';
    const H = HEROES[heroKey], s = wave.stats, b = baseline.stats;
    const safe = wave.survivors.filter(x => !x.cured).length;
    const change = b.peak - s.peak;
    $('debrief').querySelector('.lesson').style.setProperty('--hc', H.color);
    $('dPeak').textContent = s.peak; $('dBase').textContent = b.peak;
    $('dSafe').textContent = `${safe} of ${WAVE.survivors}`;
    const spec = {
      warrior: ['Grabs your Shock Wall stopped', s.wallBlocks],
      mage: ['Survivors you shielded (vaccinated)', s.vaccinated],
      paladin: ['Zombies you cured', s.cured],
      archer: ['Hub zombies cured', s.hubsCured],
    }[heroKey];
    $('dSpecLabel').textContent = spec[0]; $('dSpec').textContent = spec[1];
    const actual = s.peak < b.peak - 1 ? 'lower' : s.peak > b.peak + 1 ? 'higher' : 'same';
    const words = { lower: 'Lower', same: 'About the same', higher: 'Higher' };
    $('dPred').textContent = `${words[prediction]} ${prediction === actual ? '✓' : '✗ (it was ' + words[actual].toLowerCase() + ')'}`;
    $('dPred').style.color = prediction === actual ? 'var(--i)' : 'var(--r)';
    const lessons = {
      warrior: `Your Shock Wall stopped zombies reaching people, so each zombie made <strong>fewer contacts</strong>. In Outbreak Lab, lowering <em>contacts per day</em> lowers the peak the same way.`,
      mage: `Shielded survivors could not catch the virus, so the zombies ran out of people to spread to. In Outbreak Lab, raising <em>% vaccinated</em> does the same thing.`,
      paladin: `Cure Pulse turned zombies back early, so each one was infectious for <strong>less time</strong>. In Outbreak Lab, lowering <em>days infectious</em> shrinks the peak.`,
      archer: `Hub zombies move faster and grab more often, so they cause most of the spread. Curing them first is the <em>hubs first</em> strategy from Mission 2.`,
    };
    $('dLesson').innerHTML = `${lessons[heroKey]}<br><span class="muted">Peak ${change > 0 ? 'dropped by ' + change : change < 0 ? 'rose by ' + (-change) : 'did not change'} compared with the no-hero model.</span>`;
    // graph: hero run vs baseline
    const g = $('dGraph').getContext('2d');
    const max = townSize();
    R.graph(g, 760, 440, [
      { history: baseline.history, lines: [['i', '#9f6']], dash: [10, 8], width: 3 },
      { history: wave.history, lines: [['s', '#7cc8ff'], ['r', '#fc6'], ['i', '#9f6']], width: 4 },
    ], { max });
    // best result per hero (lowest peak)
    if (!best[heroKey] || s.peak < best[heroKey].peak) { best[heroKey] = { peak: s.peak, base: b.peak }; saveBest(); }
    show('debrief');
  }

  function buildTable() {
    const body = $('rBody'); body.innerHTML = '';
    for (const k of ORDER) {
      const H = HEROES[k], r = best[k];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="color:${H.color};font-weight:700">${H.name}</td><td>${H.variable}</td>` +
        (r ? `<td class="num">${r.peak}</td><td class="num">${r.base}</td><td class="num">${r.base - r.peak > 0 ? '−' + (r.base - r.peak) : r.base - r.peak < 0 ? '+' + (r.peak - r.base) : '0'}</td>`
           : `<td class="muted" colspan="3">Not played yet</td>`);
      body.appendChild(tr);
    }
    show('results');
  }

  // ---- buttons ----
  $('startBtn').onclick = () => { buildSelect(); show('select'); };
  $('backSel').onclick = () => { buildSelect(); show('select'); };
  $('goBtn').onclick = startWave;
  $('again').onclick = () => pickHero(heroKey);
  $('next').onclick = () => { buildSelect(); show('select'); };
  $('toTable').onclick = buildTable; $('toResults').onclick = buildTable;
  $('tableBack').onclick = () => { buildSelect(); show('select'); };
  $('resume').onclick = () => { mode = 'play'; show(null); };
  $('quit').onclick = () => { mode = 'menu'; buildSelect(); show('select'); };

  // ---- keys ----
  const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  addEventListener('keydown', e => {
    if (mode === 'play') {
      if (map[e.code]) { input[map[e.code]] = true; e.preventDefault(); }
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { input.jump = true; e.preventDefault(); }
      if (e.code === 'KeyJ') input.attack = true;
      if (e.code === 'KeyK') input.special = true;
      if (e.code === 'Escape' || e.code === 'KeyP') { mode = 'paused'; show('pause'); }
    } else if (mode === 'paused' && e.code === 'Escape') { mode = 'play'; show(null); }
  });
  addEventListener('keyup', e => { if (map[e.code]) input[map[e.code]] = false; });
  addEventListener('blur', () => { input.left = input.right = false; if (mode === 'play') { mode = 'paused'; show('pause'); } });

  // ---- loop ----
  let last = performance.now(), acc = 0;
  const DT = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; view.dt = dt;
    if (mode === 'play') {
      acc += dt;
      while (acc >= DT) {
        step(wave, DT, input);
        input.jump = input.attack = input.special = false;
        acc -= DT;
      }
      while (wave.events.length) { const ev = wave.events.shift();
        if (ev === 'hero-down') toast('Knocked down! Back on your feet…');
        if (ev === 'arrives') toast('An infected traveller has walked into town');
        if (ev === 'hub-arrives') toast('A HUB zombie has arrived: it spreads fast'); }
      R.draw(ctx, wave, view);
      hud();
      if (wave.done) endWave();
    } else if (mode === 'paused' && wave) {
      R.draw(ctx, wave, view);
    } else {
      step(attract, dt, {});
      if (attract.done) attract = createWave(SEED + Math.floor(now), 'warrior', false);
      attract.hero.x = (now / 1000 * 60) % (WAVE.length - view.W) + view.W * 0.38;
      R.draw(ctx, attract, view);
    }
    toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0;
    requestAnimationFrame(frame);
  }

  function hud() {
    const h = wave.hero, H = HEROES[heroKey];
    $('hHp').innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < h.hp ? '' : 'off'}"></i>`).join('');
    $('hSp').style.width = `${100 * (1 - h.cd / H.cooldown)}%`;
    const left = Math.max(0, Math.ceil(WAVE.duration - wave.t));
    $('timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('nS').textContent = healthyCount(wave); $('nI').textContent = infectedCount(wave);
    $('nR').textContent = wave.stats.cured + wave.stats.naturalCures;
    R.graph($('live').getContext('2d'), 540, 152, [{ history: wave.history, lines: [['s', '#7cc8ff'], ['r', '#fc6'], ['i', '#9f6']], width: 4 }],
      { max: townSize() });
  }

  // debug/testing handle (read-only use)
  window.__arcade = { get wave() { return wave; }, get mode() { return mode; }, get baseline() { return baseline; } };

  // ---- boot ----
  R.loadAll(p => { $('loadbar').firstElementChild.style.width = `${Math.round(p * 100)}%`; }).then(() => {
    $('startBtn').disabled = false; $('startBtn').textContent = 'Start'; $('startBtn').focus();
    $('loadbar').style.visibility = 'hidden';
  });
  requestAnimationFrame(frame);
})();
