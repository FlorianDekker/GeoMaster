/* GeoMaster — a vanilla-JS geography quiz.
   Data: Natural Earth 110m (world.geojson) + capitals (extra.js). Flags: flagcdn.com. */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const flag = (code, w = 320) => `https://flagcdn.com/w${w}/${code}.png`;
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const icon = p => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const fmtPop = n => (n && n > 0) ? Number(n).toLocaleString('en-US') : '—';

const REGIONS = ['All', 'Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
const MODES = { mc: 'Choice', type: 'Type', capital: 'Capital', map: 'Map' };
const SKIP_CONTINENT = new Set(['Antarctica', 'Seven seas (open ocean)']);
const EXTRA_ALIASES = {
  us: ['usa', 'us', 'america', 'unitedstates'], gb: ['uk', 'britain', 'greatbritain', 'england'],
  ae: ['uae'], cd: ['drc', 'congokinshasa'], cg: ['congobrazzaville'], cz: ['czechia'],
  nl: ['holland'], kr: ['southkorea'], kp: ['northkorea'], ru: ['russia'], sy: ['syria'],
  va: ['vatican'], mm: ['burma'], ci: ['ivorycoast'], cv: ['caboverde'], sz: ['swaziland'],
  mk: ['macedonia'], tl: ['easttimor'], la: ['laos'], bn: ['brunei'], tz: ['tanzania'],
};
const TIME_PER_Q = 20;
const AUTO_ADVANCE_MS = 2000;
const HS_KEY = 'geomaster.high';

let GEO = [];           // {code,name,region,aliases[],cap,pop,geometry}
let byCode = {};        // code -> country
let mapTemplate = null; // <svg> built once

/* ---------- map rendering (equirectangular) ---------- */
const W = 1000, H = 500;
const project = ([lon, lat]) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
function ringPath(ring) {
  let d = '';
  for (let i = 0; i < ring.length; i++) { const [x, y] = project(ring[i]); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
  return d + 'Z';
}
function geoPath(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map(poly => poly.map(ringPath).join('')).join('');
}
function bbox(geom) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const ring of poly) for (const pt of ring) {
    const [x, y] = project(pt);
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  return [mnx, mny, mxx, mxy];
}
function buildMap() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  for (const c of GEO) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', geoPath(c.geometry));
    p.setAttribute('class', 'country');
    p.dataset.code = c.code;
    svg.append(p);
  }
  return svg;
}
function worldMap({ highlight = null, zoom = false } = {}) {
  const svg = mapTemplate.cloneNode(true);
  if (highlight) {
    const t = svg.querySelector(`[data-code="${highlight}"]`);
    if (t) { t.classList.add('hl'); svg.append(t); }          // raise to top
    if (zoom && byCode[highlight]) {
      const [mnx, mny, mxx, mxy] = bbox(byCode[highlight].geometry);
      let w = mxx - mnx, h = mxy - mny;
      const pad = Math.max(w, h) * 0.55 + 6;
      let vx = mnx - pad, vy = mny - pad, vw = w + 2 * pad, vh = h + 2 * pad;
      const MIN = 34;                                          // don't over-zoom tiny states
      if (vw < MIN) { vx -= (MIN - vw) / 2; vw = MIN; }
      if (vh < MIN) { vy -= (MIN - vh) / 2; vh = MIN; }
      svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
  }
  return svg;
}

/* ---------- data load ---------- */
async function loadData() {
  const caps = window.GEO_CAPITALS || {};
  const res = await fetch('world.geojson');
  const json = await res.json();
  for (const f of json.features) {
    const p = f.properties;
    if (SKIP_CONTINENT.has(p.CONTINENT)) continue;
    let code = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH : p.ISO_A2;
    if (!code || code === '-99') continue;
    code = code.toLowerCase();
    const aliases = new Set([p.NAME, p.NAME_LONG, p.NAME_EN, p.NAME_CIAWF, p.NAME_SORT].map(norm).filter(Boolean));
    (EXTRA_ALIASES[code] || []).forEach(a => aliases.add(norm(a)));
    GEO.push({
      code, name: p.NAME_LONG || p.NAME, region: p.CONTINENT,
      aliases: [...aliases], cap: caps[code] || null, pop: +p.POP_EST || 0, geometry: f.geometry,
    });
  }
  GEO.sort((a, b) => a.name.localeCompare(b.name));
  byCode = Object.fromEntries(GEO.map(c => [c.code, c]));
  mapTemplate = buildMap();
}

/* ---------- highscores ---------- */
const highs = () => { try { return JSON.parse(localStorage.getItem(HS_KEY)) || {}; } catch { return {}; } };
const hsKey = () => `${S.mode}|${S.region}`;
const getHigh = () => highs()[hsKey()] || 0;
function saveHigh(score) { const h = highs(); const k = hsKey(); if (score > (h[k] || 0)) { h[k] = score; try { localStorage.setItem(HS_KEY, JSON.stringify(h)); } catch {} return true; } return false; }

/* ---------- game state ---------- */
const S = {
  screen: 'home', mode: 'mc', region: 'All',
  queue: [], current: null, options: [], chosen: null, typed: '',
  lives: 3, streak: 0, bestStreak: 0, score: 0,
  correct: 0, answered: 0, total: 0, missed: [],
  locked: false, feedback: null, timeLeft: TIME_PER_Q, win: false,
  prevHigh: 0, newHigh: false,
  timer: null, advTimer: null,
};
const isMC = () => S.mode === 'mc' || S.mode === 'capital';
const isTextEntry = () => S.mode === 'type' || S.mode === 'map';
function pool() {
  let list = S.region === 'All' ? GEO : GEO.filter(c => c.region === S.region);
  if (S.mode === 'capital') list = list.filter(c => c.cap);
  return list;
}
const matches = (typed, c) => { const t = norm(typed); return !!t && c.aliases.includes(t); };
const optLabel = o => S.mode === 'capital' ? o.cap : o.name;

function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
function clearAdv() { if (S.advTimer) { clearTimeout(S.advTimer); S.advTimer = null; } }
function startTimer() {
  stopTimer();
  S.timer = setInterval(() => {
    if (S.locked) return;
    S.timeLeft--;
    if (S.timeLeft <= 0) { S.timeLeft = 0; answer(false); }
    else updateTimer();
  }, 1000);
}

function start() {
  clearAdv();
  const q = shuffle(pool());
  if (!q.length) return;
  Object.assign(S, {
    screen: 'play', queue: q, total: q.length, lives: 3, streak: 0,
    bestStreak: 0, score: 0, correct: 0, answered: 0, missed: [], newHigh: false,
  });
  loadNext();
}
function loadNext() {
  clearAdv();
  const current = S.queue.shift();
  let options = [];
  if (isMC()) {
    const others = shuffle(GEO.filter(c => c.code !== current.code && (S.mode !== 'capital' || c.cap))).slice(0, 3);
    options = shuffle([current, ...others]);
  }
  Object.assign(S, { current, options, chosen: null, typed: '', feedback: null, locked: false, timeLeft: TIME_PER_Q });
  render();
  startTimer();
  if (isTextEntry()) setTimeout(() => { const i = $('.tinput'); if (i) i.focus(); }, 60);
}
function answer(correct) {
  if (S.locked) return;
  stopTimer();
  S.locked = true;
  S.answered++;
  if (correct) {
    S.score += 100 + S.timeLeft * 4 + S.streak * 10;
    S.streak++;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    S.correct++;
    S.feedback = { ok: true };
  } else {
    S.lives--;
    S.streak = 0;
    S.missed.push(S.current);
    S.feedback = { ok: false };
  }
  render();
  if (S.mode !== 'map') S.advTimer = setTimeout(() => { S.advTimer = null; next(); }, AUTO_ADVANCE_MS);
}
function next() {
  clearAdv();
  if (S.lives <= 0) return end(false);
  if (S.queue.length === 0) return end(true);
  loadNext();
}
function end(win) {
  stopTimer(); clearAdv();
  S.prevHigh = getHigh();
  S.newHigh = saveHigh(S.score);
  S.win = win; S.screen = 'results';
  render();
}
function goHome() { stopTimer(); clearAdv(); S.screen = 'home'; S.locked = false; S.feedback = null; render(); }

const chooseMC = o => { if (S.locked) return; S.chosen = o.code; answer(o.code === S.current.code); };
const submitType = () => { if (S.locked || !S.typed.trim()) return; answer(matches(S.typed, S.current)); };

/* ---------- light updates during a question ---------- */
function updateTimer() {
  const t = $('.pill.timer'); if (!t) return;
  const low = S.timeLeft <= 5;
  t.style.background = low ? 'var(--redbg)' : '#fff';
  t.style.color = low ? '#C2334B' : '#9B5DE5';
  const v = $('.timer-val'); if (v) v.textContent = S.timeLeft + 's';
}

/* ---------- render ---------- */
const app = () => $('#app');
function render() {
  const root = app();
  root.innerHTML = '';
  root.append(S.screen === 'home' ? Home() : S.screen === 'play' ? Play() : Results());
}

function Home() {
  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'map' }),
    el('div', { class: 'fade' }),
    el('div', { class: 'brand' }, [
      el('div', { class: 'brandrow' }, [
        el('div', { class: 'logo', html: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>') }),
        el('span', { class: 'fredoka', style: 'font-size:19px' }, 'GeoMaster'),
      ]),
      el('h1', {}, ['How much of the', el('br'), 'world do you know?']),
    ]),
  ]);
  $('.map', hero).append(worldMap());

  const seg = el('div', { class: 'segment' },
    Object.entries(MODES).map(([k, lbl]) =>
      el('div', { class: 'seg tap' + (S.mode === k ? ' on' : ''), onclick: () => { S.mode = k; render(); } }, lbl)));

  const chips = el('div', { class: 'chips' },
    REGIONS.map(r => el('div', {
      class: 'chip tap' + (S.region === r ? ' on' : ''),
      onclick: () => { S.region = r; render(); }
    }, r === 'All' ? 'All' : r)));

  const count = pool().length;
  const best = getHigh();
  const sheet = el('div', { class: 'sheet scroll' }, [
    seg,
    el('div', { class: 'label' }, 'REGION'),
    chips,
    el('div', { class: 'spacer' }),
    el('div', { class: 'hsbar' }, [
      el('div', { class: 'crown', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#FF8A3D"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z"/></svg>' }),
      el('div', { class: 'meta' }, [
        el('b', {}, best ? best.toLocaleString('en-US') : 'No score yet'),
        el('span', {}, `BEST · ${MODES[S.mode].toUpperCase()} · ${(S.region === 'All' ? 'ALL' : S.region).toUpperCase()}`),
      ]),
    ]),
    el('div', { class: 'poolline' }, [
      el('span', { html: icon('<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'), style: 'width:15px;height:15px;display:inline-flex' }),
      `${S.region === 'All' ? 'All regions' : S.region} · ${count} countries`,
    ]),
    el('button', { class: 'play tap', onclick: start }, [
      el('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>', style: 'display:inline-flex' }),
      'Play',
    ]),
  ]);

  return el('div', { class: 'home' }, [hero, sheet]);
}

function Play() {
  const wrap = el('div', { class: 'play-wrap' }, [Hud()]);
  wrap.append(S.mode === 'map' ? MapStage() : FlagStage());
  wrap.append(ActionBar());
  return wrap;
}

function Hud() {
  const hearts = el('div', { class: 'hearts' },
    [0, 1, 2].map(i => el('span', {
      html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="${i < S.lives ? '#FF5670' : '#E2D6DC'}"><path d="M12 21s-7-4.6-9.3-9C1.2 8.9 2.7 5.4 6.2 5.4c2 0 3.2 1.2 3.8 2.2.6-1 1.8-2.2 3.8-2.2 3.5 0 5 3.5 3.5 6.6C19 16.4 12 21 12 21z"/></svg>`
    })));
  const pct = S.total ? Math.round((S.answered / S.total) * 100) : 0;
  const low = S.timeLeft <= 5;
  return el('div', { class: 'hud' }, [
    el('div', { class: 'top' }, [
      el('button', { class: 'iconbtn tap', onclick: goHome, html: '<svg width="8" height="14" viewBox="0 0 9 16" fill="none" stroke="#5046E5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1L1 8l6 7"/></svg>' }),
      el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })),
      hearts,
    ]),
    el('div', { class: 'stats' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        el('div', { class: 'pill streak' }, [
          el('span', { html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="#FF8A3D"><path d="M12 2c1 3-1.5 4.5-1.5 7 0 1.4 1 2.4 1.5 3 .5-.8 1-1.6 1-2.6 2 1.6 3 3.6 3 5.6a6 6 0 11-12 0c0-3 2-5 4-7 .4 2 .6 3 .6 3S12 6 12 2z"/></svg>', style: 'display:inline-flex' }),
          String(S.streak),
        ]),
        el('div', { class: 'pill pts' }, [el('span', {}, 'PTS'), el('b', {}, String(S.score))]),
      ]),
      el('div', { class: 'pill timer', style: `background:${low ? 'var(--redbg)' : '#fff'};color:${low ? '#C2334B' : '#9B5DE5'}` }, [
        el('span', { html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', style: 'display:inline-flex' }),
        el('span', { class: 'timer-val' }, S.timeLeft + 's'),
      ]),
    ]),
  ]);
}

function FlagStage() {
  const promptText = S.mode === 'capital' ? `What is the capital of ${S.current.name}?`
    : S.mode === 'type' ? 'Name this country' : 'Which country is this?';
  const stage = el('div', { class: 'flagstage scroll' }, [
    el('div', { class: 'flagcard' }, el('img', { src: flag(S.current.code, 640), alt: 'flag' })),
    el('div', { class: 'prompt' }, promptText),
  ]);
  if (isMC()) {
    stage.append(el('div', { class: 'grid2' }, S.options.map(o => {
      let cls = 'opt tap';
      if (S.locked) {
        if (o.code === S.current.code) cls = 'opt right';
        else if (o.code === S.chosen) cls = 'opt wrong';
        else cls = 'opt dim';
      }
      return el('div', { class: cls, onclick: () => chooseMC(o) }, optLabel(o));
    })));
  } else {
    stage.append(TypeInput('typebox'));
  }
  return stage;
}

function MapStage() {
  const stage = el('div', { class: 'mapstage' });
  stage.append(worldMap({ highlight: S.current.code, zoom: true }));
  return stage;
}

function TypeInput(wrapClass) {
  const ok = S.locked && S.feedback && S.feedback.ok;
  const no = S.locked && S.feedback && !S.feedback.ok;
  const input = el('input', {
    class: 'tinput' + (ok ? ' ok' : no ? ' no' : ''),
    value: S.typed, placeholder: 'Type the country…', disabled: S.locked ? '' : null,
    oninput: e => S.typed = e.target.value,
    onkeydown: e => { if (e.key === 'Enter') submitType(); },
  });
  const btn = el('button', { class: 'checkbtn tap' + (S.locked ? ' dis' : ''), onclick: submitType }, 'Check answer');
  return el('div', { class: wrapClass }, [input, btn]);
}

function ActionBar() {
  const bar = el('div', { class: 'actionbar' });
  if (S.mode === 'map' && !S.locked) {
    const input = el('input', {
      class: 'tinput', value: S.typed, placeholder: 'Name this country…',
      oninput: e => S.typed = e.target.value,
      onkeydown: e => { if (e.key === 'Enter') submitType(); },
    });
    bar.append(el('div', { class: 'maprow' }, [input, el('button', { class: 'gobtn tap', onclick: submitType }, 'Go')]));
  }
  if (S.locked) {
    const fb = S.feedback;
    const color = fb.ok ? '#16A34A' : '#C2334B';
    const c = S.current;
    const txt = el('div', { class: 'txt' }, el('b', {}, fb.ok ? 'Correct!' : (S.mode === 'capital' ? `It’s ${c.cap}` : `It was ${c.name}`)));
    if (S.mode === 'map') txt.append(el('small', {}, `${c.name} · Capital: ${c.cap || '—'} · ${fmtPop(c.pop)} people`));
    bar.append(el('div', { class: 'feedback ' + (fb.ok ? 'right' : 'wrong') }, [
      txt,
      el('button', { class: 'nextbtn tap', style: `background:${color}`, onclick: next },
        S.lives <= 0 ? 'See results' : S.queue.length === 0 ? 'Finish' : 'Next'),
    ]));
  }
  return bar;
}

function Results() {
  const acc = S.answered ? Math.round((S.correct / S.answered) * 100) : 0;
  const kids = [
    el('div', { class: 'resbadge', style: S.win ? 'background:#FFF7E0;color:#E6A700' : 'background:#FFE9EC;color:#C2334B' }, S.win ? '★' : '✕'),
    el('div', { class: 'restitle' }, S.win ? 'Round complete!' : 'Game over'),
    el('div', { class: 'ressub' }, `${MODES[S.mode]} · ${S.region}`),
  ];
  if (S.newHigh) kids.push(el('div', { class: 'newhighwrap' }, el('div', { class: 'newhigh' }, '🏆 New high score!')));
  kids.push(
    el('div', { class: 'statcards' }, [
      el('div', { class: 'statcard sc-p' }, [el('b', {}, String(S.score)), el('span', {}, 'SCORE')]),
      el('div', { class: 'statcard sc-g' }, [el('b', {}, acc + '%'), el('span', {}, 'ACCURACY')]),
      el('div', { class: 'statcard sc-o' }, [el('b', {}, Math.max(S.prevHigh, S.score).toLocaleString('en-US')), el('span', {}, 'BEST EVER')]),
    ]),
    el('div', { class: 'missedhead' }, [
      el('div', { class: 'l' }, `${S.correct} of ${S.total} correct`),
      el('div', { class: 'r' }, S.missed.length ? `${S.missed.length} missed` : 'Flawless!'),
    ]),
    el('div', { class: 'missedlist scroll' }, S.missed.map(c =>
      el('div', { class: 'missrow' }, [
        el('div', { class: 'mf' }, el('img', { src: flag(c.code, 160), alt: '' })),
        el('b', {}, S.mode === 'capital' ? `${c.name} — ${c.cap}` : c.name),
      ]))),
    el('div', { class: 'resbtns' }, [
      el('button', { class: 'homebtn tap', onclick: goHome, html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5046E5"><path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>' }),
      el('button', { class: 'againbtn tap', onclick: start }, 'Play again'),
    ]),
  );
  return el('div', { class: 'results' }, kids);
}

/* ---------- boot ---------- */
loadData().then(render).catch(err => {
  app().innerHTML = `<div class="loading">Couldn't load map data.<br><small>${err.message}</small></div>`;
});
