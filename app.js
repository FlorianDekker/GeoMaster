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
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const icon = p => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
function fmtPop(n) {
  if (!n || n <= 0) return '—';
  try { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase(); }
  catch { return Number(n).toLocaleString('en-US'); }
}

const REGIONS = ['All', 'Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
const DIFFS = ['All', 'Easy', 'Medium', 'Hard'];
const MODES = { mc: 'Choice', type: 'Type', capital: 'Capital', map: 'Map' };
const LEARN_MODES = { flags: 'Flags', capitals: 'Capitals', map: 'Map' };
const SKIP_CONTINENT = new Set(['Antarctica', 'Seven seas (open ocean)']);
const EXTRA_ALIASES = {
  us: ['usa', 'us', 'america', 'unitedstates'], gb: ['uk', 'britain', 'greatbritain', 'england'],
  ae: ['uae'], cd: ['drc', 'congokinshasa'], cg: ['congobrazzaville'], cz: ['czechia'],
  nl: ['holland'], kr: ['southkorea'], kp: ['northkorea'], ru: ['russia'], sy: ['syria'],
  va: ['vatican'], mm: ['burma'], ci: ['ivorycoast'], cv: ['caboverde'], sz: ['swaziland'],
  mk: ['macedonia'], tl: ['easttimor'], la: ['laos'], bn: ['brunei'], tz: ['tanzania'],
};
// visually similar flag groups -> used to pick harder distractors
const FLAG_FAMILIES = [
  ['is', 'no', 'se', 'dk', 'fi'],            // Nordic crosses
  ['ru', 'rs', 'si', 'sk', 'hr', 'cz'],      // pan-Slavic tricolours
  ['nl', 'lu', 'py'],                        // red-white-blue horizontal
  ['co', 'ec', 've'],                        // yellow-blue-red
  ['td', 'ro', 'md', 'ad'],                  // blue-yellow-red vertical
  ['ie', 'ci'],                              // green-white-orange
  ['id', 'mc', 'pl', 'sg'],                  // red-white
  ['at', 'lv'],                              // red-white-red
  ['eg', 'sy', 'iq', 'ye', 'sd'],            // pan-Arab horizontal
  ['ae', 'kw', 'jo', 'ps'],                  // Arab with triangle
  ['sn', 'ml', 'gn', 'cm'],                  // green-yellow-red vertical
  ['ar', 'gt', 'ni', 'sv', 'hn'],            // Central America blue-white-blue
  ['au', 'nz'],                              // Union Jack ensigns
  ['tr', 'tn', 'dz'],                        // red with crescent
  ['ca', 'pe'],                              // red-white-red vertical
];
const FAMILY_OF = {};
for (const fam of FLAG_FAMILIES) for (const c of fam) if (!FAMILY_OF[c]) FAMILY_OF[c] = fam;

const TIME_PER_Q = 20;
const AUTO_ADVANCE_MS = 1000;
const FIFTY_PER_ROUND = 3;
const W_POP = 0.6, W_LABEL = 0.4;
const LEARN_ACTIVE = 8;
const LEARN_INTERVALS = [3, 6, 12, 25, 50];
const MASTER_BOX = 5;
const HS_KEY = 'geomaster.high', STATS_KEY = 'geomaster.stats', MASTERY_KEY = 'geomaster.mastery';

let GEO = [];
let byCode = {};
let mapTemplate = null;

/* ---------- map projection (Web Mercator, clamped) ---------- */
const W = 1000, LAT_MAX = 83;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const MAXM = mercY(LAT_MAX);
const H = Math.round(W * MAXM / Math.PI);
const project = ([lon, lat]) => [((lon + 180) / 360) * W, (MAXM - mercY(clamp(lat, -LAT_MAX, LAT_MAX))) / (2 * MAXM) * H];

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
function frameView(geom, zoomFactor = 1.1, min = 70) {
  const [mnx, mny, mxx, mxy] = bbox(geom);
  let w = mxx - mnx, h = mxy - mny;
  const pad = Math.max(w, h) * zoomFactor + 10;
  let x = mnx - pad, y = mny - pad; w += 2 * pad; h += 2 * pad;
  if (w < min) { x -= (min - w) / 2; w = min; }
  if (h < min) { y -= (min - h) / 2; h = min; }
  return { x, y, w, h };
}
function buildMap() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  for (const c of GEO) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', geoPath(c.geometry));
    p.setAttribute('class', 'country');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    p.dataset.code = c.code;
    svg.append(p);
  }
  return svg;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function worldMap({ highlight = null, view = null, fit = 'meet', marker = null } = {}) {
  const svg = mapTemplate.cloneNode(true);
  if (highlight) {
    const t = svg.querySelector(`[data-code="${highlight}"]`);
    if (t) { t.classList.add('hl'); svg.append(t); }
  }
  if (view) {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid ' + fit);
  }
  if (marker && marker.ll) {
    const [lat, lng] = marker.ll, [x, y] = project([lng, lat]);
    const span = view ? Math.max(view.w, view.h) : W;
    const r = span * 0.02;
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', r);
    dot.setAttribute('class', 'citydot');
    svg.append(dot);
    if (marker.label) {
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', x + r * 1.5); tx.setAttribute('y', y + r * 0.5);
      tx.setAttribute('font-size', span * 0.05); tx.setAttribute('class', 'citylbl');
      tx.textContent = marker.label;
      svg.append(tx);
    }
  }
  return svg;
}
const homeView = () => { const top = project([0, 78])[1], bot = project([0, -58])[1]; return { x: 0, y: top, w: W, h: bot - top }; };

/* interactive pan/zoom */
const MIN_W = 8, MAX_W = 1400;
const viewScale = (rect, v) => Math.min(rect.width / v.w, rect.height / v.h);
function clientToUnit(cx, cy, rect, v) {
  const s = viewScale(rect, v);
  const ox = (rect.width - v.w * s) / 2, oy = (rect.height - v.h * s) / 2;
  return { x: v.x + (cx - rect.left - ox) / s, y: v.y + (cy - rect.top - oy) / s };
}
function zoomAt(v, cx, cy, rect, k) {
  const f = clientToUnit(cx, cy, rect, v);
  const nw = clamp(v.w * k, MIN_W, MAX_W), r = nw / v.w, nh = v.h * r;
  v.x = f.x - (f.x - v.x) * r; v.y = f.y - (f.y - v.y) * r; v.w = nw; v.h = nh;
}
function setupMap(container, svg, v) {
  const pts = new Map(); let pinch = 0;
  const apply = () => svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
  const down = e => { try { container.setPointerCapture(e.pointerId); } catch {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } };
  const move = e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = svg.getBoundingClientRect();
    if (pts.size === 1) { const s = viewScale(rect, v); v.x -= (e.clientX - prev.x) / s; v.y -= (e.clientY - prev.y) / s; apply(); }
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) { zoomAt(v, (a.x + b.x) / 2, (a.y + b.y) / 2, rect, pinch / d); apply(); } pinch = d; }
  };
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  container.addEventListener('pointerdown', down);
  container.addEventListener('pointermove', move);
  container.addEventListener('pointerup', up);
  container.addEventListener('pointercancel', up);
  container.addEventListener('wheel', e => { e.preventDefault(); const rect = svg.getBoundingClientRect(); zoomAt(v, e.clientX, e.clientY, rect, e.deltaY > 0 ? 1.12 : 1 / 1.12); apply(); }, { passive: false });
  return apply;
}

/* ---------- data load ---------- */
async function loadData() {
  const caps = window.GEO_CAPITALS || {};
  const res = await fetch('world.geojson?v=4');
  const json = await res.json();
  const raw = [];
  for (const f of json.features) {
    const p = f.properties;
    if (SKIP_CONTINENT.has(p.CONTINENT)) continue;
    let code = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH : p.ISO_A2;
    if (!code || code === '-99') continue;
    code = code.toLowerCase();
    const aliases = new Set([p.NAME, p.NAME_LONG, p.NAME_EN, p.NAME_CIAWF, p.NAME_SORT].map(norm).filter(Boolean));
    (EXTRA_ALIASES[code] || []).forEach(a => aliases.add(norm(a)));
    const ce = caps[code];
    const cap = ce ? (typeof ce === 'string' ? ce : ce.n) : null;
    const capll = (ce && typeof ce === 'object' && ce.ll) ? ce.ll : null;
    raw.push({
      code, name: p.NAME_LONG || p.NAME, region: p.CONTINENT, aliases: [...aliases],
      cap, capll, pop: +p.POP_EST || 0, label: +p.LABELRANK || 5, geometry: f.geometry,
    });
  }
  const logs = raw.map(c => Math.log10(c.pop + 1));
  const lo = Math.min(...logs), hi = Math.max(...logs), span = (hi - lo) || 1;
  for (const c of raw) c.prom = W_POP * (Math.log10(c.pop + 1) - lo) / span + W_LABEL * (7 - c.label) / 5;
  GEO = raw.sort((a, b) => a.name.localeCompare(b.name));
  byCode = Object.fromEntries(GEO.map(c => [c.code, c]));
  mapTemplate = buildMap();
}

/* ---------- pools & difficulty ---------- */
const regionList = () => S.region === 'All' ? GEO : GEO.filter(c => c.region === S.region);
function applyDifficulty(list, diff) {
  if (diff === 'All' || list.length < 3) return list;
  const sorted = list.slice().sort((a, b) => b.prom - a.prom);
  const t = Math.ceil(sorted.length / 3);
  if (diff === 'Easy') return sorted.slice(0, t);
  if (diff === 'Medium') return sorted.slice(t, 2 * t);
  return sorted.slice(2 * t);
}
function pool() {
  let list = regionList();
  if (S.mode === 'capital') list = list.filter(c => c.cap);
  return applyDifficulty(list, S.difficulty);
}
const learnPool = () => {
  let list = applyDifficulty(regionList(), S.difficulty);
  if (S.learnMode === 'capitals') list = list.filter(c => c.cap);
  return list;
};
const matches = (typed, c) => { const t = norm(typed); return !!t && c.aliases.includes(t); };
const optLabel = o => S.mode === 'capital' ? o.cap : o.name;

function pickDistractors(current, n = 3, requireCap = false) {
  const taken = new Set([current.code]);
  const picks = [];
  const grab = arr => {
    for (const c of shuffle(arr)) {
      if (picks.length >= n) break;
      if (c && !taken.has(c.code) && (!requireCap || c.cap)) { picks.push(c); taken.add(c.code); }
    }
  };
  grab((FAMILY_OF[current.code] || []).map(code => byCode[code]).filter(Boolean));   // similar flags first
  grab(GEO.filter(c => c.region === current.region));                                 // then same region
  grab(GEO);                                                                          // then anything
  return picks;
}

/* ---------- persistence ---------- */
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const highs = () => readJSON(HS_KEY, {});
const hsKey = () => `${S.mode}|${S.region}|${S.difficulty}`;
const getHigh = () => highs()[hsKey()] || 0;
function saveHigh(score) { const h = highs(), k = hsKey(); if (score > (h[k] || 0)) { h[k] = score; writeJSON(HS_KEY, h); return true; } return false; }
function bestForMode(mode) {
  const h = highs(); let best = 0, ctx = '';
  for (const [k, v] of Object.entries(h)) { const [m, r, d] = k.split('|'); if (m === mode && v > best) { best = v; ctx = (r || 'All') + (d && d !== 'All' ? ' · ' + d : ''); } }
  return { best, ctx };
}
const mastery = () => readJSON(MASTERY_KEY, {});
const masteredCount = () => Object.values(mastery()).filter(m => (m.box || 0) >= MASTER_BOX).length;
function bumpStats() {
  const s = readJSON(STATS_KEY, { games: 0, answered: 0, correct: 0, bestStreak: 0 });
  s.games += 1; s.answered += S.answered; s.correct += S.correct; s.bestStreak = Math.max(s.bestStreak, S.bestStreak);
  writeJSON(STATS_KEY, s);
}

/* ---------- game state ---------- */
const S = {
  screen: 'home', mode: 'mc', region: 'All', difficulty: 'All', learnMode: 'flags',
  queue: [], current: null, options: [], chosen: null, typed: '',
  lives: 3, streak: 0, bestStreak: 0, score: 0,
  correct: 0, answered: 0, total: 0, missed: [],
  locked: false, feedback: null, timeLeft: TIME_PER_Q, win: false,
  prevHigh: 0, newHigh: false,
  fiftyLeft: FIFTY_PER_ROUND, fiftyUsedThisQ: false, hidden: [],
  mapView: null, mapDefault: null,
  learn: null,
  timer: null, advTimer: null,
};
const isMC = () => S.mode === 'mc' || S.mode === 'capital';
const isTextEntry = () => S.mode === 'type' || S.mode === 'map';

function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
function clearAdv() { if (S.advTimer) { clearTimeout(S.advTimer); S.advTimer = null; } }
function startTimer() {
  stopTimer();
  S.timer = setInterval(() => {
    if (S.locked) return;
    S.timeLeft--;
    if (S.timeLeft <= 0) { S.timeLeft = 0; answer(false); } else updateTimer();
  }, 1000);
}

function start() {
  clearAdv();
  const q = shuffle(pool());
  if (!q.length) return;
  Object.assign(S, {
    screen: 'play', queue: q, total: q.length, lives: 3, streak: 0,
    bestStreak: 0, score: 0, correct: 0, answered: 0, missed: [], newHigh: false, fiftyLeft: FIFTY_PER_ROUND,
  });
  loadNext();
}
function loadNext() {
  clearAdv();
  const current = S.queue.shift();
  let options = [];
  if (isMC()) options = shuffle([current, ...pickDistractors(current, 3, S.mode === 'capital')]);
  Object.assign(S, { current, options, chosen: null, typed: '', feedback: null, locked: false, timeLeft: TIME_PER_Q, fiftyUsedThisQ: false, hidden: [] });
  if (S.mode === 'map') { const dv = frameView(current.geometry, 2.2, 150); S.mapDefault = dv; S.mapView = { ...dv }; }
  render();
  startTimer();
  if (isTextEntry()) setTimeout(() => { const i = $('.tinput'); if (i) i.focus(); }, 60);
}
function answer(correct) {
  if (S.locked) return;
  stopTimer();
  S.locked = true; S.answered++;
  if (correct) {
    S.score += S.fiftyUsedThisQ ? 50 : (100 + S.timeLeft * 4 + S.streak * 10);
    S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); S.correct++;
    S.feedback = { ok: true };
  } else {
    S.lives--; S.streak = 0; S.missed.push(S.current); S.feedback = { ok: false };
  }
  render();
  // auto-advance only for the fast flag modes; capital & map stay so you can study the location
  if (correct && (S.mode === 'mc' || S.mode === 'type')) S.advTimer = setTimeout(() => { S.advTimer = null; next(); }, AUTO_ADVANCE_MS);
}
function next() {
  clearAdv();
  if (S.lives <= 0) return end(false);
  if (S.queue.length === 0) return end(true);
  loadNext();
}
function end(win) {
  stopTimer(); clearAdv();
  S.prevHigh = getHigh(); S.newHigh = saveHigh(S.score); bumpStats();
  S.win = win; S.screen = 'results'; render();
}
function goHome() { stopTimer(); clearAdv(); S.screen = 'home'; S.locked = false; S.feedback = null; render(); }
function goScores() { stopTimer(); clearAdv(); S.screen = 'scores'; render(); }
function goLearnSetup() { stopTimer(); clearAdv(); S.screen = 'learnsetup'; render(); }

const chooseMC = o => { if (S.locked || S.hidden.includes(o.code)) return; S.chosen = o.code; answer(o.code === S.current.code); };
const submitType = () => { if (S.locked || !S.typed.trim()) return; answer(matches(S.typed, S.current)); };
function useFifty() {
  if (!isMC() || S.locked || S.fiftyLeft <= 0 || S.hidden.length) return;
  S.hidden = shuffle(S.options.filter(o => o.code !== S.current.code).map(o => o.code)).slice(0, 2);
  S.fiftyUsedThisQ = true; S.fiftyLeft--; render();
}

function updateTimer() {
  const t = $('.pill.timer'); if (!t) return;
  const low = S.timeLeft <= 5;
  t.style.background = low ? 'var(--redbg)' : '#fff';
  t.style.color = low ? '#C2334B' : '#9B5DE5';
  const v = $('.timer-val'); if (v) v.textContent = S.timeLeft + 's';
}

/* ---------- learn mode (Leitner adaptive drill) ---------- */
function startLearn() {
  const list = learnPool();
  const codes = list.map(c => c.code);
  if (!codes.length) return;
  const m = mastery();
  const boxes = {}; for (const c of codes) boxes[c] = (m[c] && m[c].box) || 0;
  const remaining = codes.filter(c => boxes[c] < MASTER_BOX).sort((a, b) => byCode[b].prom - byCode[a].prom);
  S.learn = { codes, boxes, dueAt: {}, queue: remaining, active: new Set(), step: 0, current: null, revealed: false, typed: '', graded: null, override: null, viaShow: false, firstTry: false, done: false };
  S.screen = 'learn';
  learnPick(); render();
}
function learnPick() {
  const L = S.learn;
  const inPlay = c => L.active.has(c) && L.boxes[c] < MASTER_BOX;
  let due = [...L.active].filter(c => inPlay(c) && (L.dueAt[c] || 0) <= L.step);
  if (!due.length && L.active.size < LEARN_ACTIVE && L.queue.length) { const c = L.queue.shift(); L.active.add(c); L.dueAt[c] = L.step; due = [c]; }
  if (!due.length) due = [...L.active].filter(inPlay);
  if (!due.length) { L.done = true; L.current = null; return; }
  due.sort((a, b) => (L.boxes[a] - L.boxes[b]) || ((L.dueAt[a] || 0) - (L.dueAt[b] || 0)));
  L.current = due[0]; L.revealed = false; L.typed = ''; L.graded = null; L.override = null; L.viaShow = false;
  L.firstTry = !((mastery()[L.current] || {}).seen);
}
function learnReveal(viaShow) {
  const L = S.learn, c = byCode[L.current];
  L.viaShow = !!viaShow;
  L.graded = viaShow ? false : (S.learnMode === 'capitals' ? norm(L.typed) === norm(c.cap || '') : matches(L.typed, c));
  L.revealed = true; render();
}
function learnNext() {
  const L = S.learn, c = L.current;
  const ok = L.override != null ? L.override : L.graded;
  if (ok && L.firstTry && !L.viaShow && L.override == null) L.boxes[c] = MASTER_BOX;       // knew it first try → mastered
  else L.boxes[c] = ok ? Math.min(MASTER_BOX, L.boxes[c] + 1) : Math.max(0, L.boxes[c] - 2);
  const m = mastery(); m[c] = { box: L.boxes[c], lastSeen: Date.now(), seen: ((m[c] && m[c].seen) || 0) + 1 }; writeJSON(MASTERY_KEY, m);
  if (L.boxes[c] >= MASTER_BOX) L.active.delete(c);
  else L.dueAt[c] = L.step + LEARN_INTERVALS[Math.min(L.boxes[c], LEARN_INTERVALS.length - 1)];
  L.step++;
  learnPick(); render();
}

/* ---------- render ---------- */
const app = () => $('#app');
function render() {
  const root = app();
  root.innerHTML = '';
  const v = { home: Home, play: Play, results: Results, scores: Scores, learnsetup: LearnSetup, learn: Learn }[S.screen];
  root.append(v());
}
function chipRow(label, items, sel, onPick) {
  return [el('div', { class: 'label' }, label),
  el('div', { class: 'chips' }, items.map(r => el('div', { class: 'chip tap' + (sel === r ? ' on' : ''), onclick: () => onPick(r) }, r)))];
}
const backBtn = fn => el('button', { class: 'iconbtn tap', onclick: fn, html: '<svg width="8" height="14" viewBox="0 0 9 16" fill="none" stroke="#5046E5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1L1 8l6 7"/></svg>' });
const homeIcon = (fn, fill = '#5046E5') => el('button', { class: 'homebtn tap', onclick: fn, html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="${fill}"><path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>` });

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
  $('.map', hero).append(worldMap({ view: homeView(), fit: 'slice' }));

  const seg = el('div', { class: 'segment' }, Object.entries(MODES).map(([k, lbl]) => el('div', { class: 'seg tap' + (S.mode === k ? ' on' : ''), onclick: () => { S.mode = k; render(); } }, lbl)));
  const count = pool().length;
  const best = getHigh();
  const sheet = el('div', { class: 'sheet scroll' }, [
    seg,
    ...chipRow('REGION', REGIONS, S.region, r => { S.region = r; render(); }),
    ...chipRow('DIFFICULTY', DIFFS, S.difficulty, d => { S.difficulty = d; render(); }),
    el('div', { class: 'spacer' }),
    el('div', { class: 'hsbar' }, [
      el('div', { class: 'crown', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#FF8A3D"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z"/></svg>' }),
      el('div', { class: 'meta' }, [el('b', {}, best ? best.toLocaleString('en-US') : 'No score yet'), el('span', {}, `BEST · ${MODES[S.mode].toUpperCase()} · ${(S.region === 'All' ? 'ALL' : S.region).toUpperCase()} · ${S.difficulty.toUpperCase()}`)]),
    ]),
    el('div', { class: 'poolline' }, [el('span', { html: icon('<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'), style: 'width:15px;height:15px;display:inline-flex' }), `${count} countries`]),
    el('button', { class: 'play tap', onclick: start, disabled: count ? null : '' }, [el('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>', style: 'display:inline-flex' }), 'Play']),
    el('div', { class: 'secrow' }, [
      el('button', { class: 'secbtn tap', onclick: goLearnSetup }, '📚 Learn'),
      el('button', { class: 'secbtn tap', onclick: goScores }, '🏆 Scores'),
    ]),
  ]);
  return el('div', { class: 'home' }, [hero, sheet]);
}

function LearnSetup() {
  const list = learnPool();
  return el('div', { class: 'results' }, [
    el('div', { class: 'scoreshead' }, [backBtn(goHome), el('div', { class: 'restitle', style: 'margin:0' }, 'Learn'), el('div', { style: 'width:34px' })]),
    el('div', { class: 'ressub', style: 'margin-top:4px' }, 'Adaptive practice — focuses on what you don’t know yet'),
    el('div', { class: 'sheet', style: 'padding:14px 0 0' }, [
      ...chipRow('MODE', Object.values(LEARN_MODES), LEARN_MODES[S.learnMode], lbl => { S.learnMode = Object.keys(LEARN_MODES).find(k => LEARN_MODES[k] === lbl); render(); }),
      ...chipRow('REGION', REGIONS, S.region, r => { S.region = r; render(); }),
      ...chipRow('DIFFICULTY', DIFFS, S.difficulty, d => { S.difficulty = d; render(); }),
    ]),
    el('div', { class: 'poolline', style: 'margin-top:18px' }, `${list.length} countries · ${masteredCount()} mastered so far`),
    el('button', { class: 'play tap', onclick: startLearn, disabled: list.length ? null : '' }, [el('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>', style: 'display:inline-flex' }), 'Start learning']),
  ]);
}

function Play() {
  const wrap = el('div', { class: 'play-wrap' }, [Hud()]);
  wrap.append(S.mode === 'map' ? MapStage() : FlagStage());
  wrap.append(ActionBar());
  return wrap;
}

function Hud() {
  const hearts = el('div', { class: 'hearts' }, [0, 1, 2].map(i => el('span', { html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="${i < S.lives ? '#FF5670' : '#E2D6DC'}"><path d="M12 21s-7-4.6-9.3-9C1.2 8.9 2.7 5.4 6.2 5.4c2 0 3.2 1.2 3.8 2.2.6-1 1.8-2.2 3.8-2.2 3.5 0 5 3.5 3.5 6.6C19 16.4 12 21 12 21z"/></svg>` })));
  const pct = S.total ? Math.round((S.answered / S.total) * 100) : 0;
  const low = S.timeLeft <= 5;
  return el('div', { class: 'hud' }, [
    el('div', { class: 'top' }, [backBtn(goHome), el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })), hearts]),
    el('div', { class: 'stats' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        el('div', { class: 'pill streak' }, [el('span', { html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="#FF8A3D"><path d="M12 2c1 3-1.5 4.5-1.5 7 0 1.4 1 2.4 1.5 3 .5-.8 1-1.6 1-2.6 2 1.6 3 3.6 3 5.6a6 6 0 11-12 0c0-3 2-5 4-7 .4 2 .6 3 .6 3S12 6 12 2z"/></svg>', style: 'display:inline-flex' }), String(S.streak)]),
        el('div', { class: 'pill pts' }, [el('span', {}, 'PTS'), el('b', {}, String(S.score))]),
      ]),
      el('div', { class: 'pill timer', style: `background:${low ? 'var(--redbg)' : '#fff'};color:${low ? '#C2334B' : '#9B5DE5'}` }, [el('span', { html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', style: 'display:inline-flex' }), el('span', { class: 'timer-val' }, S.timeLeft + 's')]),
    ]),
  ]);
}

function FlagStage() {
  const promptText = S.mode === 'capital' ? `What is the capital of ${S.current.name}?` : S.mode === 'type' ? 'Name this country' : 'Which country is this?';
  const stage = el('div', { class: 'flagstage scroll' }, [el('div', { class: 'flagcard' }, el('img', { src: flag(S.current.code, 640), alt: 'flag' })), el('div', { class: 'prompt' }, promptText)]);
  if (isMC()) {
    if (!S.locked) stage.append(el('div', { class: 'fiftyrow' }, el('button', { class: 'fifty tap' + (S.fiftyLeft && !S.hidden.length ? '' : ' dis'), onclick: useFifty }, `50:50 · ${S.fiftyLeft} left`)));
    stage.append(el('div', { class: 'grid2' }, S.options.map(o => {
      let cls = 'opt tap';
      if (S.hidden.includes(o.code)) cls = 'opt gone';
      else if (S.locked) cls = o.code === S.current.code ? 'opt right' : o.code === S.chosen ? 'opt wrong' : 'opt dim';
      return el('div', { class: cls, onclick: () => chooseMC(o) }, optLabel(o));
    })));
    if (S.mode === 'capital' && S.locked) {
      const c = S.current;
      stage.append(el('div', { class: 'label', style: 'text-align:center;margin-top:16px' }, `${c.cap} · ${c.name}`));
      const wrap = el('div', { class: 'citymapwrap' });
      wrap.append(worldMap({ highlight: c.code, view: frameView(c.geometry, 1.6, 110), marker: c.capll ? { ll: c.capll, label: c.cap } : null }));
      stage.append(wrap);
    }
  } else stage.append(TypeInput('typebox'));
  return stage;
}

function MapStage() {
  const stage = el('div', { class: 'mapstage' });
  const svg = worldMap({ highlight: S.current.code, view: S.mapView });
  stage.append(svg);
  const apply = setupMap(stage, svg, S.mapView);
  const center = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r]; };
  stage.append(el('div', { class: 'zoomctl' }, [
    el('button', { class: 'zbtn tap', onclick: () => { const [x, y, r] = center(); zoomAt(S.mapView, x, y, r, 0.7); apply(); } }, '+'),
    el('button', { class: 'zbtn tap', onclick: () => { const [x, y, r] = center(); zoomAt(S.mapView, x, y, r, 1 / 0.7); apply(); } }, '−'),
    el('button', { class: 'zbtn tap', onclick: () => { Object.assign(S.mapView, S.mapDefault); apply(); }, html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V5a2 2 0 012-2h4M21 9V5a2 2 0 00-2-2h-4M3 15v4a2 2 0 002 2h4M21 15v4a2 2 0 01-2 2h-4"/></svg>' }),
  ]));
  return stage;
}

function TypeInput(wrapClass) {
  const ok = S.locked && S.feedback && S.feedback.ok, no = S.locked && S.feedback && !S.feedback.ok;
  const input = el('input', { class: 'tinput' + (ok ? ' ok' : no ? ' no' : ''), value: S.typed, placeholder: 'Type the country…', disabled: S.locked ? '' : null, oninput: e => S.typed = e.target.value, onkeydown: e => { if (e.key === 'Enter') submitType(); } });
  return el('div', { class: wrapClass }, [input, el('button', { class: 'checkbtn tap' + (S.locked ? ' dis' : ''), onclick: submitType }, 'Check answer')]);
}

function feedbackBox(extraNext) {
  const fb = S.feedback, color = fb.ok ? '#16A34A' : '#C2334B', c = S.current;
  const main = fb.ok ? 'Correct!' : (S.mode === 'capital' ? `It’s ${c.cap}` : `It was ${c.name}`);
  const txt = el('div', { class: 'txt' }, [el('b', {}, main), el('small', {}, `${c.name} · ${c.cap || '—'} · ${fmtPop(c.pop)}`)]);
  return el('div', { class: 'feedback ' + (fb.ok ? 'right' : 'wrong') }, [txt, el('button', { class: 'nextbtn tap', style: `background:${color}`, onclick: next }, S.lives <= 0 ? 'See results' : S.queue.length === 0 ? 'Finish' : 'Next')]);
}

function ActionBar() {
  const bar = el('div', { class: 'actionbar' });
  if (S.mode === 'map' && !S.locked) {
    const input = el('input', { class: 'tinput', value: S.typed, placeholder: 'Name this country…', oninput: e => S.typed = e.target.value, onkeydown: e => { if (e.key === 'Enter') submitType(); } });
    bar.append(el('div', { class: 'maprow' }, [input, el('button', { class: 'gobtn tap', onclick: submitType }, 'Go')]));
  }
  if (S.locked) bar.append(feedbackBox());
  return bar;
}

function Results() {
  const acc = S.answered ? Math.round((S.correct / S.answered) * 100) : 0;
  const kids = [
    el('div', { class: 'resbadge', style: S.win ? 'background:#FFF7E0;color:#E6A700' : 'background:#FFE9EC;color:#C2334B' }, S.win ? '★' : '✕'),
    el('div', { class: 'restitle' }, S.win ? 'Round complete!' : 'Game over'),
    el('div', { class: 'ressub' }, `${MODES[S.mode]} · ${S.region} · ${S.difficulty}`),
  ];
  if (S.newHigh) kids.push(el('div', { class: 'newhighwrap' }, el('div', { class: 'newhigh' }, '🏆 New high score!')));
  kids.push(
    el('div', { class: 'statcards' }, [
      el('div', { class: 'statcard sc-p' }, [el('b', {}, String(S.score)), el('span', {}, 'SCORE')]),
      el('div', { class: 'statcard sc-g' }, [el('b', {}, acc + '%'), el('span', {}, 'ACCURACY')]),
      el('div', { class: 'statcard sc-o' }, [el('b', {}, Math.max(S.prevHigh, S.score).toLocaleString('en-US')), el('span', {}, 'BEST EVER')]),
    ]),
    el('div', { class: 'missedhead' }, [el('div', { class: 'l' }, `${S.correct} of ${S.total} correct`), el('div', { class: 'r' }, S.missed.length ? `${S.missed.length} missed` : 'Flawless!')]),
    el('div', { class: 'missedlist scroll' }, S.missed.map(c => el('div', { class: 'missrow' }, [el('div', { class: 'mf' }, el('img', { src: flag(c.code, 160), alt: '' })), el('b', {}, S.mode === 'capital' ? `${c.name} — ${c.cap}` : c.name)]))),
    el('div', { class: 'resbtns' }, [homeIcon(goHome), el('button', { class: 'homebtn tap', onclick: goScores, html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#FF8A3D"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z"/></svg>' }), el('button', { class: 'againbtn tap', onclick: start }, 'Play again')]),
  );
  return el('div', { class: 'results' }, kids);
}

function Scores() {
  const st = readJSON(STATS_KEY, { games: 0, answered: 0, correct: 0, bestStreak: 0 });
  const acc = st.answered ? Math.round((st.correct / st.answered) * 100) : 0;
  const rows = Object.entries(MODES).map(([k, lbl]) => {
    const { best, ctx } = bestForMode(k);
    return el('div', { class: 'scorerow' }, [el('div', { class: 'sm' }, lbl), el('div', { class: 'sv' }, [el('b', {}, best ? best.toLocaleString('en-US') : '—'), el('span', {}, best ? ctx : 'not played')])]);
  });
  return el('div', { class: 'results' }, [
    el('div', { class: 'scoreshead' }, [backBtn(goHome), el('div', { class: 'restitle', style: 'margin:0' }, 'Your scores'), el('div', { style: 'width:34px' })]),
    el('div', { class: 'statcards', style: 'margin-top:16px' }, [
      el('div', { class: 'statcard sc-p' }, [el('b', {}, String(st.games)), el('span', {}, 'GAMES')]),
      el('div', { class: 'statcard sc-g' }, [el('b', {}, acc + '%'), el('span', {}, 'ACCURACY')]),
      el('div', { class: 'statcard sc-o' }, [el('b', {}, `${masteredCount()}/${GEO.length}`), el('span', {}, 'MASTERED')]),
    ]),
    el('div', { class: 'label', style: 'margin:20px 0 4px' }, 'BEST PER MODE'),
    el('div', { class: 'scorelist scroll' }, rows),
    el('div', { class: 'resbtns' }, [homeIcon(goHome), el('button', { class: 'againbtn tap', onclick: goLearnSetup }, '📚 Learn weak spots')]),
  ]);
}

function Learn() {
  const L = S.learn;
  const total = L.codes.length, mastered = L.codes.filter(c => L.boxes[c] >= MASTER_BOX).length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;
  const head = el('div', { class: 'learnhead' }, [backBtn(goHome), el('div', { class: 'learnprog' }, [el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })), el('span', {}, `${mastered}/${total} mastered`)])]);

  if (L.done) return el('div', { class: 'learn' }, [head, el('div', { class: 'learndone' }, [
    el('div', { class: 'resbadge', style: 'background:#FFF7E0;color:#E6A700' }, '★'),
    el('div', { class: 'restitle' }, 'All mastered!'),
    el('div', { class: 'ressub' }, `${total} countries · ${LEARN_MODES[S.learnMode]} · ${S.region}`),
    el('div', { class: 'resbtns', style: 'margin-top:18px' }, [homeIcon(goHome), el('button', { class: 'againbtn tap', onclick: goLearnSetup }, 'New session')]),
  ])]);

  const c = byCode[L.current];
  const card = el('div', { class: 'learncard scroll' });
  if (S.learnMode === 'map') { const mm = el('div', { class: 'minimap', style: 'height:220px' }); mm.append(worldMap({ highlight: c.code, view: frameView(c.geometry, 1.8, 110) })); card.append(mm); }
  else card.append(el('div', { class: 'flagcard' }, el('img', { src: flag(c.code, 640), alt: 'flag' })));

  if (!L.revealed) {
    const promptText = S.learnMode === 'capitals' ? `What is the capital of ${c.name}?` : 'Which country is this?';
    card.append(el('div', { class: 'prompt' }, promptText));
    const input = el('input', { class: 'tinput', value: L.typed, placeholder: S.learnMode === 'capitals' ? 'Type the capital…' : 'Type the country…', oninput: e => L.typed = e.target.value, onkeydown: e => { if (e.key === 'Enter') learnReveal(false); } });
    card.append(el('div', { class: 'typebox' }, [input, el('div', { class: 'learnbtns' }, [el('button', { class: 'checkbtn tap', style: 'flex:1', onclick: () => learnReveal(false) }, 'Check'), el('button', { class: 'showbtn tap', onclick: () => learnReveal(true) }, 'Show')])]));
    setTimeout(() => input.focus(), 60);
  } else {
    const ok = L.override != null ? L.override : L.graded;
    card.append(el('div', { class: 'reveal ' + (ok ? 'right' : 'wrong') }, [
      el('div', { class: 'rvname' }, c.name),
      el('div', { class: 'rvgrid' }, [
        el('div', {}, [el('span', {}, 'CAPITAL'), el('b', {}, c.cap || '—')]),
        el('div', {}, [el('span', {}, 'POPULATION'), el('b', {}, fmtPop(c.pop))]),
        el('div', {}, [el('span', {}, 'REGION'), el('b', {}, c.region)]),
        el('div', {}, [el('span', {}, 'RESULT'), el('b', {}, ok ? (L.firstTry && !L.viaShow && L.override == null ? '✓ mastered' : '✓ knew it') : '✗ review')]),
      ]),
    ]));
    if (S.learnMode !== 'map') { const mm = el('div', { class: 'minimap' }); mm.append(worldMap({ highlight: c.code, view: frameView(c.geometry, 1.8, 110), marker: (S.learnMode === 'capitals' && c.capll) ? { ll: c.capll, label: c.cap } : null })); card.append(mm); }
    card.append(el('div', { class: 'learnbtns' }, [el('button', { class: 'showbtn tap', onclick: () => { L.override = !ok; render(); } }, ok ? 'Mark wrong' : 'I knew it'), el('button', { class: 'checkbtn tap', style: 'flex:1', onclick: learnNext }, 'Next →')]));
  }
  return el('div', { class: 'learn' }, [head, card]);
}

/* ---------- boot ---------- */
loadData().then(render).catch(err => {
  app().innerHTML = `<div class="loading">Couldn't load map data.<br><small>${err.message}</small></div>`;
});
