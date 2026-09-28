'use strict';

/* ==========================================================================
   CyberRevision
   Plain JavaScript, no build step. Pages are rendered into <main id="content">
   from the URL hash (#home, #create, #study/<set id>, …). Everything personal
   (sets, progress, tasks, streaks) lives in localStorage; accounts, published
   sets and chat go through the Worker API on the same origin.
   ========================================================================== */

const API = '';
const DAY = 86400000;
const SUBJECTS = ['Maths', 'Science', 'Computer Science', 'English', 'History', 'Languages', 'Other'];
const INTERVALS = [0, 1, 2, 4, 8, 16, 32]; // days until a card comes back, by Leitner box

/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const slug = text => String(text).toLowerCase().replace(/[^a-z]+/g, '-');
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const isTyping = target => target?.closest?.('input, textarea, select, [contenteditable]');

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Storage is full or blocked, so this change could not be saved.', 'bad'); return false; }
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3800);
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function confetti(origin, amount = 36) { // origin: an element or {x, y} in viewport pixels
  if (calm()) return;
  const box = origin?.getBoundingClientRect ? origin.getBoundingClientRect() : null;
  const x = box ? box.left + box.width / 2 : origin?.x ?? innerWidth / 2, y = box ? box.top + box.height / 3 : origin?.y ?? innerHeight / 3;
  const colours = ['#7c6bff', '#14b4dc', '#f0b04e', '#45c98d', '#ff7aa8', '#ffffff'];
  for (let i = 0; i < amount; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti';
    const angle = Math.random() * Math.PI * 2, power = 120 + Math.random() * 220;
    bit.style.setProperty('--x', `${x}px`); bit.style.setProperty('--y', `${y}px`);
    bit.style.setProperty('--dx', `${Math.cos(angle) * power}px`); bit.style.setProperty('--dy', `${Math.sin(angle) * power - 160}px`);
    bit.style.setProperty('--r', `${Math.random() * 720 - 360}deg`); bit.style.setProperty('--c', colours[i % colours.length]);
    bit.style.setProperty('--t', `${700 + Math.random() * 600}ms`);
    document.body.append(bit);
    setTimeout(() => bit.remove(), 1400);
  }
}

function countUp(root = document) {
  for (const el of $$('[data-count]', root)) {
    const target = Number(el.dataset.count);
    if (calm() || !target) { el.textContent = target; continue; }
    const start = performance.now(), length = Math.min(900, 300 + target * 40);
    const step = now => { const p = Math.min(1, (now - start) / length); el.textContent = Math.round(target * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(() => { el.textContent = target; }, length + 100); // background tabs pause animation frames
  }
}

function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

function hash(text) { // FNV-1a, used to give each card a stable id
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

async function request(path, init = {}) {
  const response = await fetch(API + path, { credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) { user = null; updateUser(); }
    throw new Error(data?.error || 'Something went wrong. Please try again.');
  }
  return data;
}
const post = (path, body, method = 'POST') => request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/* ---------- Starter sets ---------- */

const card = (front, back) => ({ front, back });
const samples = [
  { id: 'sample-biology', name: 'Cells and life processes', subject: 'Science', cards: [
    card('What is the function of the mitochondria?', 'Where aerobic respiration happens, releasing energy for the cell.'),
    card('What does the nucleus contain?', 'Genetic material (DNA) that controls the cell.'),
    card('What is diffusion?', 'The net movement of particles from a higher to a lower concentration.'),
    card('What is osmosis?', 'The diffusion of water through a partially permeable membrane.'),
    card('What do ribosomes do?', 'Make proteins (protein synthesis).'),
    card('What is the function of chloroplasts?', 'Absorb light for photosynthesis.'),
    card('What is a plant cell wall made of?', 'Cellulose.'),
    card('Word equation for aerobic respiration?', 'Glucose + oxygen → carbon dioxide + water')] },
  { id: 'sample-maths', name: 'Algebra essentials', subject: 'Maths', cards: [
    card('Solve: 3x + 6 = 21', 'x = 5'),
    card('Expand: 2(x + 4)', '2x + 8'),
    card('Factorise: x² + 5x + 6', '(x + 2)(x + 3)'),
    card('Gradient of y = 4x − 7?', '4'),
    card('Solve: x² = 49', 'x = 7 or x = −7'),
    card('Simplify: a³ × a⁴', 'a⁷'),
    card('What is 15% of 80?', '12'),
    card('Expand: (x + 3)(x − 3)', 'x² − 9')] },
  { id: 'sample-cs', name: 'Inside the computer', subject: 'Computer Science', cards: [
    card('What does CPU stand for?', 'Central processing unit'),
    card('What is an algorithm?', 'A sequence of steps that solves a problem.'),
    card('What is a Boolean value?', 'A value that is either true or false.'),
    card('What is RAM?', 'Random access memory: volatile memory that holds running programs and data.'),
    card('How many bits are in a byte?', '8'),
    card('What is binary 1010 in denary?', '10'),
    card('What does HTML stand for?', 'HyperText Markup Language'),
    card('What is a variable?', 'A named location in memory that stores a value which can change.')] },
  { id: 'sample-english', name: 'Language techniques', subject: 'English', cards: [
    card('Simile', 'Comparing two things using “like” or “as”.'),
    card('Metaphor', 'Describing something as if it were something else.'),
    card('Personification', 'Giving human qualities to something that is not human.'),
    card('Alliteration', 'Repeating the same sound at the start of nearby words.'),
    card('Onomatopoeia', 'A word that imitates the sound it describes.'),
    card('Hyperbole', 'Deliberate exaggeration for effect.'),
    card('Oxymoron', 'Two contradictory words placed together, e.g. “deafening silence”.'),
    card('Rhetorical question', 'A question asked for effect, not for an answer.')] },
  { id: 'sample-history', name: 'Dates that changed Britain', subject: 'History', cards: [
    card('Battle of Hastings', '1066'),
    card('Magna Carta sealed', '1215'),
    card('Great Fire of London', '1666'),
    card('Who was the first Tudor monarch?', 'Henry VII'),
    card('Start of the First World War', '1914'),
    card('Some women gain the vote in the UK', '1918'),
    card('End of the Second World War', '1945'),
    card('Fall of the Berlin Wall', '1989')] }
].map(set => ({ ...set, author: 'CyberRevision', sample: true }));

/* ---------- State ---------- */

const validSet = s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.subject === 'string'
  && Array.isArray(s.cards) && s.cards.length > 0 && s.cards.every(c => c && typeof c.front === 'string' && typeof c.back === 'string');

let user = null;
let remoteSets = [];
let setsLoaded = false;
let offline = false;
let localSets = (Array.isArray(read('CR_SETS', [])) ? read('CR_SETS', []) : []).filter(validSet);
let tasks = (Array.isArray(read('CR_TASKS', [])) ? read('CR_TASKS', []) : []).filter(t => t && typeof t.title === 'string');
let sessions = Number(read('CR_SESSIONS', 0)) || 0;
let best = read('CR_BEST', {}); if (!best || typeof best !== 'object') best = {};
let progress = read('CR_PROGRESS', {}); if (!progress || typeof progress !== 'object') progress = {};
let activity = read('CR_ACTIVITY', {}); if (!activity || typeof activity !== 'object') activity = {};
const libraryFilter = { search: '', subject: 'All', sort: 'recent' };

const isLocal = set => localSets.some(s => s.id === set.id);
const isMine = set => Boolean(user && set.ownerId === user.id);
const allSets = () => [...localSets, ...remoteSets.filter(r => !localSets.some(l => l.id === r.id)), ...samples];
const findSet = id => allSets().find(s => s.id === id);

/* ---------- Streaks and activity ---------- */

function logActivity(kind) { // kind: 'c' = card reviewed, 'f' = focus session
  const today = dayKey();
  const entry = typeof activity[today] === 'object' ? activity[today] : { c: 0, f: 0 };
  entry[kind] = (entry[kind] || 0) + 1;
  activity[today] = entry;
  const keys = Object.keys(activity).sort();
  while (keys.length > 400) delete activity[keys.shift()];
  save('CR_ACTIVITY', activity);
  updateStreak();
  bump($('#streak-pill'));
}
const activeOn = key => { const e = activity[key]; return Boolean(e && ((e.c || 0) + (e.f || 0))); };
function streak() {
  const d = new Date();
  if (!activeOn(dayKey(d))) d.setDate(d.getDate() - 1);
  let count = 0;
  while (activeOn(dayKey(d))) { count++; d.setDate(d.getDate() - 1); }
  return count;
}
const reviewedToday = () => activity[dayKey()]?.c || 0;
function lastSevenDays() {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return { key: dayKey(d), on: activeOn(dayKey(d)), today: i === 6 }; });
}
function updateStreak() {
  const days = streak(), today = activeOn(dayKey());
  $('#streak-days').textContent = plural(days, 'day');
  $('#streak-note').textContent = today ? 'You studied today. Nice!' : days ? 'Study today to keep it going' : 'Study today to start a streak';
  $('#streak-card').classList.toggle('lit', today);
  $('#streak-count').textContent = days;
}

/* ---------- Spaced repetition (Leitner boxes) ---------- */

const cardId = (set, c) => `${c.sourceId || set.id}|${hash(c.front)}`;
const cardState = (set, c) => progress[cardId(set, c)];
const isDue = (set, c) => { const p = cardState(set, c); return !p || p.due <= Date.now(); };
function rateCard(set, c, known) {
  const id = cardId(set, c), old = progress[id] || { box: 0, seen: 0 };
  const box = known ? Math.min(old.box + 1, INTERVALS.length - 1) : 0;
  progress[id] = { box, due: Date.now() + INTERVALS[box] * DAY, seen: (old.seen || 0) + 1 };
  save('CR_PROGRESS', progress);
  logActivity('c');
}
const mastered = (set, c) => (cardState(set, c)?.box || 0) >= 3;
const masteryOf = set => Math.round(100 * set.cards.filter(c => mastered(set, c)).length / set.cards.length);
const dueIn = set => set.cards.filter(c => isDue(set, c)).length;
function reviewDeck() { // a virtual set of every due card that has been studied at least once
  const cards = allSets().flatMap(set => set.cards.filter(c => cardState(set, c) && isDue(set, c)).map(c => ({ ...c, sourceId: set.id })));
  return { id: 'review', name: 'Due for review', subject: 'Other', cards, virtual: true };
}

/* ---------- Answer checking ---------- */

const normalise = text => String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(the|a|an) /, '');
function distance(a, b) {
  if (a.length > 300 || b.length > 300) return Infinity;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function grade(input, answer) {
  const a = normalise(input), b = normalise(answer);
  if (!a) return 'wrong';
  if (a === b) return 'correct';
  if (distance(a, b) <= Math.max(1, Math.floor(b.length * 0.15))) return 'close';
  return 'wrong';
}

/* ---------- Shell: user, theme, navigation ---------- */

function updateUser() {
  $('#username').textContent = user?.username || 'Guest';
  $('#user-note').textContent = user ? 'Signed in' : 'Not signed in';
  $('#avatar').textContent = (user?.username || '?')[0].toUpperCase();
}

function effectiveTheme() {
  const chosen = read('CR_THEME', null);
  return chosen || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme() {
  const chosen = read('CR_THEME', null);
  if (chosen) document.documentElement.dataset.theme = chosen; else delete document.documentElement.dataset.theme;
  const dark = effectiveTheme() === 'dark';
  for (const button of [$('#theme-toggle'), $('#theme-toggle-mobile')]) {
    button.innerHTML = icon(dark ? 'sun' : 'moon');
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
}
function toggleTheme(e) {
  save('CR_THEME', effectiveTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
  bump(e?.currentTarget);
}

const titles = { home: 'Home', create: 'Create a set', edit: 'Edit set', study: 'Flashcards', quiz: 'Quiz', games: 'Arcade', planner: 'Revision planner', timer: 'Focus timer', chat: 'Community chat', account: 'Account' };
const navFor = { edit: 'create', study: 'home', quiz: 'home' };
let page = '';
let view = {}; // the current page can set view.key (keyboard handler) and view.cleanup

function route() {
  view.cleanup?.();
  view = {};
  const [name, ...rest] = location.hash.slice(1).split('/');
  const param = decodeURIComponent(rest.join('/'));
  page = titles[name] ? name : 'home';
  if (name === 'sets') page = 'home'; // old links
  $('#page-title').textContent = titles[page];
  document.title = page === 'home' ? 'CyberRevision' : `${titles[page]} · CyberRevision`;
  for (const a of $$('nav a')) {
    const on = a.dataset.page === (navFor[page] || page);
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const pages = { home, create: () => editor(), edit: () => editor(param), study: () => study(param, 'cards'), quiz: () => study(param, 'quiz'), games: () => arcade(param), planner, timer: timerPage, chat, account };
  pages[page]();
  $('#content').classList.remove('enter'); void $('#content').offsetWidth; $('#content').classList.add('enter');
  if (document.activeElement?.closest?.('nav')) $('#content').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
const go = hashValue => { if (location.hash === '#' + hashValue) route(); else location.hash = hashValue; };
const render = html => { $('#content').innerHTML = html; };
const pageHead = (eyebrow, title, subtitle, action = '') => `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div>${action}</div>`;

/* ---------- Home and library ---------- */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function home() {
  const review = reviewDeck(), days = streak(), sets = allSets();
  const masteredCount = sets.reduce((n, s) => n + s.cards.filter(c => mastered(s, c)).length, 0);
  const next = tasks.filter(t => !t.done).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))[0];
  render(`
    <section class="hero">
      <div>
        <p class="eyebrow">${greeting()}${user ? ', ' + esc(user.username) : ''}</p>
        <h1>${review.cards.length ? `${plural(review.cards.length, 'card')} ready to review.` : 'What will you learn today?'}</h1>
        <p>${review.cards.length ? 'Spaced repetition brings each card back right before you’d forget it. A few minutes now saves hours later.' : 'Pick a set below, make your own, or warm up with a game. Every card you study builds your streak.'}</p>
        <div class="actions">
          ${review.cards.length ? `<a class="button primary big" href="#study/review">Start review →</a>` : `<a class="button primary big" href="#study/${sets[0]?.id || ''}">Start studying →</a>`}
          <a class="button big" href="#create">${icon('plus')} Create a set</a>
        </div>
      </div>
      <div class="hero-cards" aria-hidden="true">
        <div class="hero-card one"><small>QUESTION</small><strong>What is osmosis?</strong></div>
        <div class="hero-card two"><small>ANSWER</small><strong>Water diffusing through a membrane.</strong></div>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><span class="stat-icon warn">${icon('flame')}</span><div><strong data-count="${days}">0</strong><small>Day streak</small><div class="week" aria-label="Last 7 days">${lastSevenDays().map(d => `<i class="${d.on ? 'on' : ''} ${d.today ? 'today' : ''}" title="${d.key}"></i>`).join('')}</div></div></div>
      <div class="stat"><span class="stat-icon">${icon('home')}</span><div><strong data-count="${reviewedToday()}">0</strong><small>Cards reviewed today</small></div></div>
      <div class="stat"><span class="stat-icon good">${icon('plan')}</span><div><strong data-count="${masteredCount}">0</strong><small>Cards mastered</small></div></div>
      <div class="stat"><span class="stat-icon cyan">${icon('timer')}</span><div><strong data-count="${sessions}">0</strong><small>Focus sessions</small></div></div>
    </div>
    <div class="section-head"><div><h2>Study library <span class="count" id="set-count"></span></h2><p>Your sets, community sets and starter sets.</p></div><a class="button soft" href="#create">${icon('plus')} New set</a></div>
    <div id="connection"></div>
    <div class="filters">
      <label class="search">${icon('search')}<span class="sr-only">Search sets</span><input id="search" type="search" placeholder="Search sets, subjects or authors…" value="${esc(libraryFilter.search)}"></label>
      <label class="sr-only" for="sort">Sort sets</label>
      <select id="sort"><option value="recent">Newest first</option><option value="due">Most due</option><option value="name">A to Z</option></select>
    </div>
    <div class="chips" id="subject-chips">${['All', ...SUBJECTS].map(s => `<button class="chip ${s === libraryFilter.subject ? 'active' : ''}" data-subject="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="sets-grid" id="sets"></div>
    <div class="section-head"><h2>Keep the momentum</h2></div>
    <div class="tools">
      <a class="tool" href="#games"><span class="stat-icon">${icon('game')}</span><div><strong>Play a revision game</strong><p>Memory match, quick-fire and true or false.</p></div></a>
      <a class="tool" href="#timer"><span class="stat-icon cyan">${icon('timer')}</span><div><strong>Start a focus session</strong><p>${timer.running ? 'Your timer is running.' : '25 minutes, one thing at a time.'}</p></div></a>
      <a class="tool" href="#planner"><span class="stat-icon good">${icon('plan')}</span><div><strong>${next ? esc(next.title) : 'Plan your week'}</strong><p>${next ? `Next up${next.date ? ' · ' + esc(formatDate(next.date)) : ''}` : 'Small goals, ticked off one by one.'}</p></div></a>
    </div>`);
  $('#sort').value = libraryFilter.sort;
  $('#search').oninput = e => { libraryFilter.search = e.target.value; renderSets(); };
  $('#sort').onchange = e => { libraryFilter.sort = e.target.value; renderSets(); };
  for (const chip of $$('[data-subject]')) chip.onclick = () => {
    libraryFilter.subject = chip.dataset.subject;
    $$('[data-subject]').forEach(c => c.classList.toggle('active', c === chip));
    renderSets();
  };
  renderSets();
  renderConnection();
  countUp();
  view.cleanup = () => document.removeEventListener('click', closeMenus);
  document.addEventListener('click', closeMenus);
}

function closeMenus(e) { if (!e.target.closest('.set-menu')) $$('.menu').forEach(m => m.hidden = true); }

function renderConnection() {
  const box = $('#connection');
  if (!box) return;
  box.innerHTML = offline ? `<div class="notice"><span>The community library can’t be reached right now. Your own sets and the starter sets still work.</span><button class="button small" id="retry">Try again</button></div>` : '';
  if (offline) $('#retry').onclick = loadSets;
}

function renderSets() {
  const grid = $('#sets');
  if (!grid) return;
  const q = libraryFilter.search.trim().toLowerCase();
  let sets = allSets().filter(s => (libraryFilter.subject === 'All' || s.subject === libraryFilter.subject)
    && `${s.name} ${s.subject} ${s.author || ''}`.toLowerCase().includes(q));
  if (libraryFilter.sort === 'name') sets.sort((a, b) => a.name.localeCompare(b.name));
  if (libraryFilter.sort === 'due') sets.sort((a, b) => dueIn(b) - dueIn(a));
  $('#set-count').textContent = sets.length;
  grid.innerHTML = sets.length ? sets.map(setCard).join('') : `<div class="empty"><strong>No sets match.</strong>Try another subject, or <a class="button small soft" href="#create">create your own</a></div>`;
  for (const el of $$('[data-menu]', grid)) el.onclick = e => {
    e.stopPropagation();
    const menu = el.nextElementSibling, open = menu.hidden;
    $$('.menu').forEach(m => m.hidden = true);
    menu.hidden = !open;
  };
  for (const el of $$('[data-action]', grid)) el.onclick = () => setAction(el.dataset.action, findSet(el.closest('[data-set]').dataset.set));
}

function setCard(set) {
  const local = isLocal(set), mine = isMine(set), due = dueIn(set), m = masteryOf(set);
  const origin = set.sample ? 'Starter set' : local && !set.ownerId ? 'On this device' : mine ? 'Published by you' : `By ${esc(set.author || 'the community')}`;
  const menu = [
    ['play', 'Play in the arcade'],
    local && !set.ownerId ? ['edit', 'Edit'] : ['copy', 'Make an editable copy'],
    local && !set.ownerId && user ? ['publish', 'Publish to community'] : null,
    ['export', 'Copy as text'],
    ['reset', 'Reset my progress'],
    local || mine ? ['delete', mine ? 'Delete published set' : 'Delete'] : null
  ].filter(Boolean);
  return `<article class="set-card" data-set="${esc(set.id)}">
    <div class="set-top"><span class="subject s-${slug(set.subject)}">${esc(set.subject)}</span><span class="meta">${plural(set.cards.length, 'card')}</span></div>
    <h3>${esc(set.name)}</h3>
    <p class="meta">${origin}</p>
    <div class="mastery"><span><span>${m}% mastered</span>${due ? `<span class="due-dot">${due} due</span>` : '<span>All caught up</span>'}</span><progress class="thin" max="100" value="${m}" aria-label="${m}% mastered"></progress></div>
    <div class="set-actions">
      <a class="button primary small" href="#study/${encodeURIComponent(set.id)}">Study</a>
      <a class="button small" href="#quiz/${encodeURIComponent(set.id)}">Quiz</a>
      <div class="set-menu"><button class="button small ghost" data-menu aria-label="More options for ${esc(set.name)}">•••</button>
        <div class="menu" hidden>${menu.map(([a, label]) => `<button data-action="${a}" class="${a === 'delete' ? 'danger' : ''}">${label}</button>`).join('')}</div></div>
    </div>
  </article>`;
}

async function setAction(action, set) {
  if (!set) return;
  if (action === 'play') return go('games/' + encodeURIComponent(set.id));
  if (action === 'edit') return go('edit/' + encodeURIComponent(set.id));
  if (action === 'copy') {
    const copy = { id: 'SET_' + crypto.randomUUID(), name: set.name + ' (copy)', subject: SUBJECTS.includes(set.subject) ? set.subject : 'Other', cards: set.cards.map(c => card(c.front, c.back)), author: user?.username || 'You', created: Date.now() };
    if (!save('CR_SETS', [...localSets, copy])) return;
    localSets.push(copy);
    toast('Copy saved. You can edit it now.', 'good');
    return go('edit/' + encodeURIComponent(copy.id));
  }
  if (action === 'export') {
    const text = set.cards.map(c => `${c.front}\t${c.back}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into “Import” on the create page to reuse it.', 'good'); }
    catch { toast('Your browser blocked copying to the clipboard.', 'bad'); }
    return;
  }
  if (action === 'reset') {
    if (!confirm(`Reset your progress on “${set.name}”?`)) return;
    for (const c of set.cards) delete progress[cardId(set, c)];
    save('CR_PROGRESS', progress);
    return renderSets();
  }
  if (action === 'publish') return publish(set);
  if (action === 'delete') {
    if (!confirm(`Delete “${set.name}”? This can’t be undone.`)) return;
    if (isMine(set)) {
      try { await request('/api/sets/' + encodeURIComponent(set.id), { method: 'DELETE' }); }
      catch (error) { return toast(error.message, 'bad'); }
      remoteSets = remoteSets.filter(s => s.id !== set.id);
    }
    const next = localSets.filter(s => s.id !== set.id);
    if (save('CR_SETS', next)) localSets = next;
    toast('Set deleted.');
    return renderSets();
  }
}

async function publish(set) {
  if (!user) return toast('Sign in to publish sets.', 'bad');
  try {
    const published = await post('/api/sets', { name: set.name, subject: set.subject, cards: set.cards.map(c => card(c.front, c.back)) });
    // Keep progress when the set's id changes to the published id.
    for (const c of set.cards) { const old = progress[cardId(set, c)]; if (old) progress[cardId(published, c)] = old; }
    save('CR_PROGRESS', progress);
    localSets = localSets.map(s => s.id === set.id ? published : s);
    remoteSets = [published, ...remoteSets.filter(s => s.id !== published.id)];
    save('CR_SETS', localSets);
    toast('Published! Everyone can study it now.', 'good');
    if (page === 'home') renderSets();
    return published;
  } catch (error) { toast(error.message, 'bad'); }
}

async function loadSets() {
  try {
    const data = await request('/api/sets');
    if (!Array.isArray(data)) throw new Error();
    remoteSets = data.filter(validSet);
    offline = false;
  } catch { offline = true; }
  setsLoaded = true;
  if (page === 'home') { renderSets(); renderConnection(); }
  if (view.waitingForSets) route();
}

/* ---------- Create and edit ---------- */

function editor(id) {
  const existing = id ? localSets.find(s => s.id === id && !s.ownerId) : null;
  if (id && !existing) {
    render(`<div class="empty"><strong>That set can’t be edited.</strong>Starter and published sets are read-only. Use “Make an editable copy” from the set’s menu.<div class="actions"><a class="button" href="#home">Back to library</a></div></div>`);
    return;
  }
  render(pageHead(existing ? 'EDIT SET' : 'NEW SET', existing ? 'Polish your set.' : 'Make it memorable.', 'Good questions make great revision. Keep answers short and in your own words.') + `
    <form id="set-form" novalidate>
      <section class="panel">
        <div class="form-grid">
          <label class="field"><span>Title</span><input id="set-name" required maxlength="120" placeholder="e.g. GCSE Physics: forces and motion"></label>
          <label class="field"><span>Subject</span><select id="set-subject">${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</select></label>
        </div>
      </section>
      <section class="panel">
        <div class="section-head"><div><h2>Cards <span class="count" id="card-count">0</span></h2><p>Tip: press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to add another card.</p></div><button class="button soft" type="button" id="toggle-import">Import from text</button></div>
        <div class="import-box" id="import-box" hidden>
          <label class="field"><span>Paste one card per line. Separate the question and answer with a tab, “ - ”, a colon or a comma.</span><textarea id="import-text" placeholder="Mitochondria - Where respiration happens&#10;Osmosis: Water moving across a membrane"></textarea></label>
          <div class="actions"><button class="button primary" type="button" id="import-add">Add cards</button><span class="help" id="import-preview"></span></div>
        </div>
        <div class="card-list" id="card-list"></div>
        <div class="actions"><button class="button" type="button" id="add-card">${icon('plus')} Add a card</button></div>
      </section>
      <div class="actions">
        <button class="button primary big" type="submit">${existing ? 'Save changes' : 'Save set'}</button>
        ${!existing || !existing.ownerId ? `<button class="button big" type="button" id="save-publish" ${user ? '' : 'disabled'}>Save and publish</button>` : ''}
        <a class="button ghost big" href="#home">Cancel</a>
      </div>
      <p class="help">${user ? 'Publishing makes a set visible to everyone. Saved sets stay in this browser.' : 'Saved sets stay in this browser. <a class="button small soft" href="#account">Sign in</a> to publish to the community.'}</p>
    </form>`);
  const list = $('#card-list');
  const addRow = (front = '', back = '') => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<label class="field"><span class="sr-only">Question</span><textarea class="front" maxlength="2000" placeholder="Question or term"></textarea></label>
      <label class="field back-field"><span class="sr-only">Answer</span><textarea class="back" maxlength="4000" placeholder="Answer or definition"></textarea></label>
      <button class="icon-button" type="button" aria-label="Remove card">✕</button>`;
    $('.front', row).value = front;
    $('.back', row).value = back;
    $('button', row).onclick = () => { if (list.children.length === 1) return toast('A set needs at least one card.'); row.remove(); countCards(); };
    list.append(row);
    countCards();
    return row;
  };
  const countCards = () => { $('#card-count').textContent = list.children.length; };
  if (existing) {
    $('#set-name').value = existing.name;
    $('#set-subject').value = existing.subject;
    existing.cards.forEach(c => addRow(c.front, c.back));
  } else { addRow(); addRow(); addRow(); }
  $('#add-card').onclick = () => $('.front', addRow()).focus();
  $('#set-form').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('.front', addRow()).focus(); } };
  $('#toggle-import').onclick = () => { $('#import-box').hidden = !$('#import-box').hidden; if (!$('#import-box').hidden) $('#import-text').focus(); };
  $('#import-text').oninput = () => { const n = parseImport($('#import-text').value).length; $('#import-preview').textContent = n ? `${plural(n, 'card')} found` : ''; };
  $('#import-add').onclick = () => {
    const cards = parseImport($('#import-text').value);
    if (!cards.length) return toast('No cards found. Put each card on its own line.', 'bad');
    for (const row of $$('.card-row', list)) if (!$('.front', row).value.trim() && !$('.back', row).value.trim()) row.remove();
    cards.forEach(c => addRow(c.front, c.back));
    $('#import-text').value = ''; $('#import-preview').textContent = ''; $('#import-box').hidden = true;
    toast(`${plural(cards.length, 'card')} added.`, 'good');
  };
  const collect = () => {
    const name = $('#set-name').value.trim();
    const rows = $$('.card-row', list).map(r => ({ row: r, front: $('.front', r).value.trim(), back: $('.back', r).value.trim() })).filter(c => c.front || c.back);
    const half = rows.find(c => !c.front || !c.back);
    if (!name) { $('#set-name').focus(); toast('Give your set a title.', 'bad'); return null; }
    if (!rows.length) { toast('Add at least one card.', 'bad'); return null; }
    if (half) { $(half.front ? '.back' : '.front', half.row).focus(); toast('Fill in both sides of every card.', 'bad'); return null; }
    if (rows.length > 100) { toast('Sets can have up to 100 cards.', 'bad'); return null; }
    return { name, subject: $('#set-subject').value, cards: rows.map(c => card(c.front, c.back)) };
  };
  const store = data => {
    const set = existing ? { ...existing, ...data } : { id: 'SET_' + crypto.randomUUID(), ...data, author: user?.username || 'You', created: Date.now() };
    const next = existing ? localSets.map(s => s.id === set.id ? set : s) : [set, ...localSets];
    if (!save('CR_SETS', next)) return null;
    localSets = next;
    return set;
  };
  $('#set-form').onsubmit = e => {
    e.preventDefault();
    const data = collect(); if (!data) return;
    if (store(data)) { toast(existing ? 'Changes saved.' : 'Set saved. Time to study!', 'good'); go('home'); }
  };
  const publishButton = $('#save-publish');
  if (publishButton) publishButton.onclick = async () => {
    const data = collect(); if (!data) return;
    const set = store(data); if (!set) return;
    publishButton.disabled = true; publishButton.textContent = 'Publishing…';
    const published = await publish(set);
    publishButton.disabled = false; publishButton.textContent = 'Save and publish';
    if (published) go('home');
  };
}

function parseImport(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    for (const sep of ['\t', ' - ', ' – ', ' — ', ': ', ':', ', ', ',']) {
      const i = line.indexOf(sep);
      if (i > 0) return card(line.slice(0, i).trim(), line.slice(i + sep.length).trim());
    }
    return null;
  }).filter(c => c && c.front && c.back).slice(0, 100);
}

/* ---------- Study: flashcards and typed quiz ---------- */

function study(id, mode) {
  const set = id === 'review' ? reviewDeck() : findSet(id);
  if (!set) {
    if (!setsLoaded) { view.waitingForSets = true; render('<div class="empty"><strong>Loading set…</strong></div>'); return; }
    render(`<div class="empty"><strong>We couldn’t find that set.</strong>It may have been deleted.<div class="actions"><a class="button" href="#home">Back to library</a></div></div>`);
    return;
  }
  if (!set.cards.length) {
    render(`<div class="empty"><strong>Nothing is due. You’re all caught up! 🎉</strong>Cards come back for review as you’re about to forget them.<div class="actions"><a class="button primary" href="#home">Back to library</a></div></div>`);
    return;
  }
  // Due cards first, then the rest, so every session is worthwhile.
  const due = shuffle(set.cards.filter(c => isDue(set, c))), rest = shuffle(set.cards.filter(c => !isDue(set, c)));
  const s = { set, mode, queue: [...due, ...rest], index: 0, flipped: false, known: 0, learning: 0, repeats: new Map(), answered: false, result: null, score: 0, missed: [] };
  mode === 'quiz' ? renderQuiz(s) : renderCard(s);
}

function studyHeader(s, label) {
  return `<div class="study-top"><a class="button small ghost" href="#home">← Library</a><span class="grow"></span><span class="pill">${label}</span></div>
    <p class="eyebrow">${esc(s.set.subject)}</p><h1>${esc(s.set.name)}</h1>
    <div class="study-meta"><span>Card ${Math.min(s.index + 1, s.queue.length)} of ${s.queue.length}</span><span>${s.mode === 'quiz' ? `${s.score} correct` : `${s.known} known · ${s.learning} learning`}</span></div>
    <progress max="${s.queue.length}" value="${s.index}" aria-label="Session progress"></progress>`;
}

function renderCard(s) {
  if (s.index >= s.queue.length) return finishStudy(s);
  const c = s.queue[s.index];
  render(`<div class="study">${studyHeader(s, 'Flashcards')}
    <div class="flip ${s.flipped ? 'flipped' : ''} ${s.dir ? 'in-' + s.dir : ''}" id="flip">
      <button class="flip-inner" id="flip-button" aria-label="${s.flipped ? 'Answer' : 'Question'}. Press to flip.">
        <div class="face front" aria-hidden="${s.flipped}"><small>QUESTION</small><strong>${esc(c.front)}</strong><span class="hint">Tap or press space to flip</span></div>
        <div class="face back" aria-hidden="${!s.flipped}"><small>ANSWER</small><strong>${esc(c.back)}</strong><span class="hint">How did you do?</span></div>
      </button>
    </div>
    <div class="rate" id="rate" ${s.flipped ? '' : 'hidden'}>
      <button class="button bad" id="learning">Still learning <kbd>1</kbd></button>
      <button class="button good" id="known">Got it <kbd>2</kbd></button>
    </div>
    <div class="actions" id="nav-actions" ${s.flipped ? 'hidden' : ''}><button class="button" id="prev" ${s.index ? '' : 'disabled'}>← Back</button><button class="button primary" id="show">Show answer</button></div>
    <div class="keys"><span><kbd>Space</kbd> flip</span><span><kbd>1</kbd> still learning</span><span><kbd>2</kbd> got it</span><span><kbd>←</kbd> back</span></div>
  </div>`);
  const flip = () => {
    s.flipped = !s.flipped;
    $('#flip').classList.toggle('flipped', s.flipped);
    $('#rate').hidden = !s.flipped; $('#nav-actions').hidden = s.flipped;
    $('#flip-button').setAttribute('aria-label', `${s.flipped ? 'Answer' : 'Question'}. Press to flip.`);
    $$('.face').forEach(f => f.setAttribute('aria-hidden', String(f.classList.contains('back') !== s.flipped)));
  };
  const rate = known => {
    if (!s.flipped) return;
    rateCard(s.set, c, known);
    if (known) s.known++;
    else {
      s.learning++;
      const times = s.repeats.get(c) || 0;
      if (times < 2) { s.repeats.set(c, times + 1); s.queue.push(c); } // see it again this session
    }
    s.dir = known ? 'right' : 'left';
    s.index++; s.flipped = false; renderCard(s);
  };
  $('#flip-button').onclick = flip;
  $('#show').onclick = flip;
  $('#known').onclick = () => rate(true);
  $('#learning').onclick = () => rate(false);
  $('#prev').onclick = () => { s.index = Math.max(0, s.index - 1); s.flipped = false; s.dir = 'left'; renderCard(s); };
  view.key = e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === '1') rate(false);
    else if (e.key === '2') rate(true);
    else if (e.key === 'ArrowLeft' && s.index) $('#prev').click();
    else if (e.key === 'ArrowRight' && !s.flipped) flip();
  };
}

function renderQuiz(s) {
  if (s.index >= s.queue.length) return finishStudy(s);
  const c = s.queue[s.index];
  render(`<div class="study">${studyHeader(s, 'Quiz')}
    <div class="question-card"><small>QUESTION</small><strong>${esc(c.front)}</strong></div>
    <form class="answer-form" id="answer-form">
      <label class="sr-only" for="answer">Your answer</label>
      <input id="answer" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type your answer…">
      <div id="feedback" role="status"></div>
      <div class="actions"><button class="button primary" id="check">Check answer</button><button class="button" type="button" id="skip">I don’t know</button><button class="button" type="button" id="override" hidden>I was right</button></div>
    </form>
    <div class="keys"><span><kbd>Enter</kbd> check, then next</span><span>Small typos are forgiven.</span></div>
  </div>`);
  const input = $('#answer');
  input.focus();
  const show = verdict => {
    s.answered = true; s.result = verdict;
    const right = verdict !== 'wrong';
    if (right) s.score++; else s.missed.push(c);
    rateCard(s.set, c, right);
    const fb = $('#feedback');
    fb.className = 'result ' + (verdict === 'correct' ? '' : verdict === 'close' ? 'close' : 'incorrect');
    fb.innerHTML = `<b>${verdict === 'correct' ? 'Correct!' : verdict === 'close' ? 'Almost. Check the spelling:' : 'Not quite. The answer is:'}</b>${verdict === 'correct' ? '' : esc(c.back)}`;
    input.disabled = true;
    $('#check').textContent = 'Next →';
    $('#skip').hidden = true;
    $('#override').hidden = verdict !== 'wrong';
    $('#check').focus();
  };
  $('#answer-form').onsubmit = e => {
    e.preventDefault();
    if (s.answered) { s.index++; s.answered = false; renderQuiz(s); return; }
    if (!input.value.trim()) return input.focus();
    show(grade(input.value, c.back));
  };
  $('#skip').onclick = () => show('wrong');
  $('#override').onclick = () => {
    s.score++; s.missed = s.missed.filter(x => x !== c); rateCard(s.set, c, true);
    $('#feedback').className = 'result'; $('#feedback').innerHTML = '<b>Marked as correct.</b>';
    $('#override').hidden = true; $('#check').focus();
  };
}

function finishStudy(s) {
  const quiz = s.mode === 'quiz', total = s.queue.length;
  const percent = quiz ? Math.round(100 * s.score / total) : Math.round(100 * s.known / Math.max(1, s.known + s.learning));
  const message = percent === 100 ? 'Flawless. You know this set.' : percent >= 75 ? 'Great work. Nearly there.' : percent >= 40 ? 'Good progress. Keep going.' : 'Every review makes it stick. Try again soon.';
  render(`<div class="study"><section class="panel done">
    <p class="eyebrow">SESSION COMPLETE</p><h1>${message}</h1>
    <div class="big-num">${percent}%</div>
    <p class="subtitle">${quiz ? `${s.score} of ${total} correct` : `${s.known} got it · ${s.learning} still learning`} · ${plural(streak(), 'day')} streak 🔥</p>
    <div class="actions">
      ${quiz && s.missed.length ? '<button class="button primary" id="retry-missed">Retry the ones I missed</button>' : ''}
      <button class="button ${quiz && s.missed.length ? '' : 'primary'}" id="again">Go again</button>
      ${s.set.virtual ? '' : `<a class="button" href="#${quiz ? 'study' : 'quiz'}/${encodeURIComponent(s.set.id)}">${quiz ? 'Flashcards' : 'Test yourself'}</a>`}
      <a class="button ghost" href="#home">Library</a>
    </div></section></div>`);
  if (percent >= 75) setTimeout(() => confetti($('.big-num')), 150);
  $('#again').onclick = () => route();
  const retry = $('#retry-missed');
  if (retry) retry.onclick = () => renderQuiz({ ...s, queue: shuffle(s.missed), index: 0, score: 0, missed: [], answered: false });
}

/* ---------- Arcade ---------- */

let game = null;
let gameTimer = null;
const bestKey = (kind, set) => `${kind}:${set.id}`;
function saveBest(kind, set, value, lowerIsBetter = false) {
  const key = bestKey(kind, set), old = best[key];
  const beat = old === undefined || (lowerIsBetter ? value < old : value > old);
  if (beat) { best = { ...best, [key]: value }; save('CR_BEST', best); }
  return beat;
}
function stopGame() { clearInterval(gameTimer); gameTimer = null; game = null; }

function arcade(presetId) {
  const sets = allSets().filter(s => s.cards.length >= 2);
  if (presetId && sets.some(s => s.id === presetId)) arcade.setId = presetId;
  if (!sets.some(s => s.id === arcade.setId)) arcade.setId = sets[0]?.id;
  view.cleanup = stopGame;
  render(pageHead('ARCADE', 'Play your way to remembering.', 'Turn any study set into a game. Every correct answer counts toward your streak.') + `
    <section class="panel">
      <label class="field"><span>Choose a study set</span><select id="game-set">${sets.map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${plural(s.cards.length, 'card')}</option>`).join('')}</select></label>
    </section>
    <div class="section-head"><h2>Pick a game</h2></div>
    <div class="tools">
      <button class="tool" id="play-memory"><span class="stat-icon">${icon('game')}</span><div><strong>Memory match</strong><p>Flip tiles and pair each question with its answer.</p><span class="best" id="best-memory"></span></div></button>
      <button class="tool" id="play-quick"><span class="stat-icon warn">${icon('timer')}</span><div><strong>Quick-fire</strong><p>60 seconds of multiple choice. Keys 1–4.</p><span class="best" id="best-quick"></span></div></button>
      <button class="tool" id="play-tf"><span class="stat-icon good">${icon('plan')}</span><div><strong>True or false</strong><p>45 seconds. Is this the right answer? Build a combo.</p><span class="best" id="best-tf"></span></div></button>
    </div>`);
  const selected = () => sets.find(s => s.id === $('#game-set').value);
  const showBest = () => {
    const s = selected(), m = best[bestKey('memory', s)], q = best[bestKey('quick', s)], t = best[bestKey('tf', s)];
    $('#best-memory').textContent = m ? `Best: ${m} moves` : 'No best yet';
    $('#best-quick').textContent = q ? `Best: ${q} correct` : 'No best yet';
    $('#best-tf').textContent = t ? `Best: ${t} points` : 'No best yet';
  };
  $('#game-set').value = arcade.setId;
  $('#game-set').onchange = e => { arcade.setId = e.target.value; showBest(); };
  showBest();
  $('#play-memory').onclick = () => startMemory(selected());
  $('#play-quick').onclick = () => startQuick(selected());
  $('#play-tf').onclick = () => startTrueFalse(selected());
}

function gameHeader(title, set, hint) {
  return `<div class="study-top"><button class="button small ghost" id="game-back">← Arcade</button><span class="grow"></span><span class="pill">${title}</span></div>
    <p class="eyebrow">${esc(set.subject)}</p><h1>${esc(set.name)}</h1><p class="subtitle">${hint}</p>`;
}
function gameOver(kind, set, headline, detail, isBest) {
  stopGame();
  render(`<div class="study"><section class="panel done">
    <p class="eyebrow">${isBest ? 'NEW PERSONAL BEST 🏆' : 'GAME OVER'}</p><h1>${headline}</h1><p class="subtitle">${detail}</p>
    <div class="actions"><button class="button primary" id="again">Play again</button><button class="button" id="game-back">Back to arcade</button></div>
  </section></div>`);
  if (isBest) setTimeout(() => confetti($('.done h1'), 60), 150);
  $('#again').onclick = () => ({ memory: startMemory, quick: startQuick, tf: startTrueFalse })[kind](set);
  $('#game-back').onclick = () => arcade(set.id);
}

function startMemory(set) {
  stopGame();
  const pairs = shuffle(set.cards).slice(0, 6);
  game = { kind: 'memory', tiles: shuffle(pairs.flatMap((c, i) => [{ pair: i, side: 'Question', text: c.front, c }, { pair: i, side: 'Answer', text: c.back, c }])), open: [], matched: 0, moves: 0, start: Date.now(), lock: false };
  render(`<div class="study">${gameHeader('Memory match', set, 'Find each question and its answer.')}
    <div class="game-bar"><span class="pill" id="g-moves">0 moves</span><span class="pill" id="g-pairs">0 / ${pairs.length} pairs</span><span class="pill" id="g-time">0s</span></div>
    <div class="memory-grid">${game.tiles.map((_, i) => `<button class="mem-tile" data-tile="${i}" aria-label="Hidden tile ${i + 1}"><span class="q">?</span></button>`).join('')}</div></div>`);
  $('#game-back').onclick = () => arcade(set.id);
  const g = game;
  const stats = () => {
    $('#g-moves').textContent = plural(g.moves, 'move');
    $('#g-pairs').textContent = `${g.matched} / ${pairs.length} pairs`;
    $('#g-time').textContent = `${Math.floor((Date.now() - g.start) / 1000)}s`;
  };
  gameTimer = setInterval(stats, 1000);
  for (const el of $$('[data-tile]')) el.onclick = () => {
    const i = Number(el.dataset.tile), tile = g.tiles[i];
    if (g.lock || tile.done || g.open.includes(i)) return;
    el.classList.add('flipped');
    el.innerHTML = `<small>${tile.side.toUpperCase()}</small><span>${esc(tile.text)}</span>`;
    el.setAttribute('aria-label', `${tile.side}: ${tile.text}`);
    g.open.push(i);
    if (g.open.length < 2) return;
    g.moves++;
    const [a, b] = g.open.map(n => g.tiles[n]);
    const els = g.open.map(n => $(`[data-tile="${n}"]`));
    if (a.pair === b.pair) {
      a.done = b.done = true; g.open = []; g.matched++;
      els.forEach(x => x.classList.add('matched'));
      confetti(els[1], 10);
      rateCard(set, a.c, true);
      stats();
      if (g.matched === pairs.length) {
        const secs = Math.round((Date.now() - g.start) / 1000), isBest = saveBest('memory', set, g.moves, true);
        setTimeout(() => gameOver('memory', set, 'All matched! ✨', `${plural(g.moves, 'move')} in ${plural(secs, 'second')}. Best: ${best[bestKey('memory', set)]} moves.`, isBest), 600);
      }
    } else {
      g.lock = true; stats();
      els.forEach(x => x.classList.add('miss'));
      setTimeout(() => {
        els.forEach((x, k) => { x.classList.remove('flipped', 'miss'); x.innerHTML = '<span class="q">?</span>'; x.setAttribute('aria-label', `Hidden tile ${g.open[k] + 1}`); });
        g.open = []; g.lock = false;
      }, 950);
    }
  };
}

function answerPool(set) { return [...new Set([...set.cards, ...allSets().filter(s => s.subject === set.subject).flatMap(s => s.cards), ...allSets().flatMap(s => s.cards)].map(c => c.back))]; }

function countdown(seconds, onTick, onEnd) {
  const end = Date.now() + seconds * 1000;
  const tick = () => { const left = Math.max(0, (end - Date.now()) / 1000); onTick(left); if (!left) { clearInterval(gameTimer); onEnd(); } };
  gameTimer = setInterval(tick, 200); tick();
  return () => end;
}

function startQuick(set) {
  stopGame();
  const pool = answerPool(set);
  const g = game = { kind: 'quick', deck: [], score: 0, asked: 0, streak: 0, lock: false, over: false };
  render(`<div class="study">${gameHeader('Quick-fire', set, 'Pick the right answer. Tap, or press 1 to 4.')}
    <div class="game-bar"><span class="pill" id="g-time">60s</span><span class="pill" id="g-score">0 correct</span><span class="pill combo" id="g-streak">🔥 0</span></div>
    <progress id="g-bar" max="60" value="60" aria-label="Time left"></progress>
    <div class="question-card" id="g-q"></div><div class="options" id="g-options"></div></div>`);
  $('#game-back').onclick = () => arcade(set.id);
  const finish = () => { g.over = true; const isBest = saveBest('quick', set, g.score); gameOver('quick', set, `${g.score} correct`, `You answered ${plural(g.asked, 'question')}. Best: ${best[bestKey('quick', set)]} correct.`, isBest); };
  const next = () => {
    if (g.over) return;
    if (!g.deck.length) g.deck = shuffle(set.cards);
    const c = g.card = g.deck.pop();
    const options = shuffle([c.back, ...shuffle(pool.filter(a => a !== c.back)).slice(0, 3)]);
    g.lock = false;
    $('#g-q').innerHTML = `<small>QUESTION</small><strong>${esc(c.front)}</strong>`;
    $('#g-options').innerHTML = options.map((o, i) => `<button class="option" data-option="${i}"><b>${i + 1}</b><span>${esc(o)}</span></button>`).join('');
    for (const b of $$('[data-option]')) b.onclick = () => {
      if (g.lock || g.over) return;
      g.lock = true; g.asked++;
      const right = options[b.dataset.option] === c.back;
      if (right) { g.score++; g.streak++; } else g.streak = 0;
      rateCard(set, c, right);
      $$('[data-option]').forEach(o => { if (options[o.dataset.option] === c.back) o.classList.add('correct'); });
      if (!right) b.classList.add('wrong');
      $('#g-score').textContent = `${g.score} correct`; $('#g-streak').textContent = `🔥 ${g.streak}`;
      setTimeout(next, right ? 380 : 1100);
    };
  };
  view.key = e => { const b = $(`[data-option="${Number(e.key) - 1}"]`); if (b) { e.preventDefault(); b.click(); } };
  next();
  countdown(60, left => { $('#g-time').textContent = `${Math.ceil(left)}s`; $('#g-bar').value = left; }, finish);
}

function startTrueFalse(set) {
  stopGame();
  const pool = answerPool(set);
  const g = game = { kind: 'tf', points: 0, combo: 0, asked: 0, right: 0, lock: false, over: false };
  render(`<div class="study">${gameHeader('True or false', set, 'Is this the right answer? Press ← or T for true, → or F for false.')}
    <div class="game-bar"><span class="pill" id="g-time">45s</span><span class="pill" id="g-score">0 points</span><span class="pill combo" id="g-combo">×1</span></div>
    <progress id="g-bar" max="45" value="45" aria-label="Time left"></progress>
    <div class="question-card" id="g-q"></div>
    <div class="tf"><button class="button good" id="g-true">✓ True</button><button class="button bad" id="g-false">✕ False</button></div></div>`);
  $('#game-back').onclick = () => arcade(set.id);
  const finish = () => { g.over = true; const isBest = saveBest('tf', set, g.points); gameOver('tf', set, `${g.points} points`, `${g.right} of ${g.asked} right. Best: ${best[bestKey('tf', set)]} points.`, isBest); };
  const next = () => {
    if (g.over) return;
    const c = g.card = set.cards[Math.floor(Math.random() * set.cards.length)];
    const others = pool.filter(a => a !== c.back);
    g.truth = !others.length || Math.random() < 0.5;
    g.shown = g.truth ? c.back : others[Math.floor(Math.random() * others.length)];
    g.lock = false;
    $('#g-q').innerHTML = `<small>QUESTION</small><strong>${esc(c.front)}</strong><span class="answer">${esc(g.shown)}</span>`;
  };
  const answer = saidTrue => {
    if (g.lock || g.over) return;
    g.lock = true; g.asked++;
    const right = saidTrue === g.truth;
    if (right) { g.right++; g.combo++; g.points += Math.min(1 + Math.floor(g.combo / 3), 5); } else g.combo = 0;
    if (g.truth) rateCard(set, g.card, right);
    $('#g-score').textContent = plural(g.points, 'point');
    $('#g-combo').textContent = `×${Math.min(1 + Math.floor(g.combo / 3), 5)}`;
    const q = $('#g-q');
    q.classList.add(right ? 'correct' : 'wrong');
    if (!right) q.innerHTML += `<span class="help">${g.truth ? 'That was correct.' : 'Correct answer: ' + esc(g.card.back)}</span>`;
    setTimeout(() => { q.classList.remove('correct', 'wrong'); next(); }, right ? 250 : 1300);
  };
  $('#g-true').onclick = () => answer(true);
  $('#g-false').onclick = () => answer(false);
  view.key = e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 't') { e.preventDefault(); answer(true); }
    if (k === 'arrowright' || k === 'f') { e.preventDefault(); answer(false); }
  };
  next();
  countdown(45, left => { $('#g-time').textContent = `${Math.ceil(left)}s`; $('#g-bar').value = left; }, finish);
}

/* ---------- Planner ---------- */

function formatDate(value) {
  if (!value) return 'No date';
  const d = new Date(value + 'T00:00:00'), today = new Date(dayKey() + 'T00:00:00');
  const diff = Math.round((d - today) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function planner() {
  render(pageHead('PLANNER', 'Plan the work. Work the plan.', 'Break revision into small tasks with a date. Ticking them off feels great.') + `
    <section class="panel">
      <form class="task-form" id="task-form">
        <label class="field"><span>What will you revise?</span><input id="task-title" required maxlength="200" placeholder="e.g. Practise quadratic equations"></label>
        <label class="field"><span>When</span><input type="date" id="task-date" value="${dayKey()}"></label>
        <label class="field"><span>Subject</span><select id="task-subject">${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</select></label>
        <button class="button primary">${icon('plus')} Add</button>
      </form>
    </section>
    <section class="panel"><div class="section-head"><h2>Your plan</h2><span class="help" id="task-summary"></span></div><progress id="task-progress" max="1" value="0" aria-label="Tasks completed"></progress><div id="tasks"></div></section>`);
  $('#task-form').onsubmit = e => {
    e.preventDefault();
    const title = $('#task-title').value.trim();
    if (!title) return $('#task-title').focus();
    const next = [...tasks, { id: crypto.randomUUID(), title, date: $('#task-date').value, subject: $('#task-subject').value, done: false }];
    if (save('CR_TASKS', next)) { tasks = next; $('#task-title').value = ''; $('#task-title').focus(); renderTasks(); }
  };
  renderTasks();
}

function renderTasks() {
  const today = dayKey();
  const sorted = [...tasks].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const groups = [
    ['overdue', 'Overdue', sorted.filter(t => !t.done && t.date && t.date < today)],
    ['today', 'Today', sorted.filter(t => !t.done && t.date === today)],
    ['upcoming', 'Coming up', sorted.filter(t => !t.done && (!t.date || t.date > today))],
    ['done', 'Done', sorted.filter(t => t.done).reverse()]
  ].filter(g => g[2].length);
  const done = tasks.filter(t => t.done).length;
  $('#task-summary').textContent = tasks.length ? `${done} of ${tasks.length} done` : '';
  $('#task-progress').max = Math.max(1, tasks.length);
  $('#task-progress').value = done;
  $('#tasks').innerHTML = groups.length ? groups.map(([key, label, list]) => `<div class="task-group ${key}"><h3>${label}</h3>${list.map(t => `
    <div class="task ${t.done ? 'done' : ''}" data-task="${esc(t.id)}">
      <input class="check" type="checkbox" ${t.done ? 'checked' : ''} aria-label="Mark “${esc(t.title)}” as done">
      <div><strong>${esc(t.title)}</strong><small>${esc(t.subject || 'Other')} · ${esc(formatDate(t.date))}</small></div>
      <button class="icon-button" aria-label="Delete “${esc(t.title)}”">✕</button>
    </div>`).join('')}</div>`).join('') : '<div class="empty"><strong>A fresh page.</strong>Add one thing you want to revise this week.</div>';
  for (const row of $$('[data-task]')) {
    const id = row.dataset.task;
    $('.check', row).onchange = e => {
      const next = tasks.map(t => t.id === id ? { ...t, done: e.target.checked } : t);
      if (save('CR_TASKS', next)) { tasks = next; if (e.target.checked) { toast('Nice! One less thing to worry about.', 'good'); confetti(e.target, 16); } }
      renderTasks();
    };
    $('.icon-button', row).onclick = () => { const next = tasks.filter(t => t.id !== id); if (save('CR_TASKS', next)) tasks = next; renderTasks(); };
  }
}
// Older versions stored tasks without ids.
tasks = tasks.map(t => t.id ? t : { ...t, id: crypto.randomUUID() });

/* ---------- Focus timer ---------- */

const MODES = { focus: { label: 'Focus', minutes: () => Number(read('CR_FOCUS_MIN', 25)) || 25 }, short: { label: 'Short break', minutes: () => 5 }, long: { label: 'Long break', minutes: () => 15 } };
const timer = { mode: 'focus', total: MODES.focus.minutes() * 60, remaining: MODES.focus.minutes() * 60, end: 0, running: false };
const clock = seconds => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

function setMode(mode) {
  timer.mode = mode; timer.running = false;
  timer.total = timer.remaining = MODES[mode].minutes() * 60;
  updateTimer();
}

function chime() {
  if (!read('CR_SOUND', true)) return;
  try {
    const ctx = new AudioContext();
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.5);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* no audio available */ }
}

function updateTimer() {
  if (timer.running) {
    timer.remaining = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    if (!timer.remaining) {
      timer.running = false;
      chime();
      if (timer.mode === 'focus') {
        sessions++; save('CR_SESSIONS', sessions); logActivity('f');
        toast('Focus session complete! Take a well-earned break.', 'good');
        setMode(sessions % 4 === 0 ? 'long' : 'short');
      } else { toast('Break over. Ready for another round?', 'good'); setMode('focus'); }
      return;
    }
  }
  const badge = $('#nav-timer');
  badge.hidden = !timer.running;
  badge.textContent = clock(timer.remaining);
  if (timer.running) document.title = `${clock(timer.remaining)} · ${MODES[timer.mode].label}`;
  else if (document.title.includes(' · Focus') || document.title.includes('break')) document.title = page === 'home' ? 'CyberRevision' : `${titles[page]} · CyberRevision`;
  if (page !== 'timer' || !$('#ring-bar')) return;
  const length = 2 * Math.PI * 140;
  $('#ring-bar').setAttribute('stroke-dashoffset', String(length * (1 - timer.remaining / timer.total)));
  $('#ring-time').textContent = clock(timer.remaining);
  $('#ring-mode').textContent = MODES[timer.mode].label;
  $('.ring').classList.toggle('running', timer.running);
  $('#timer-toggle').textContent = timer.running ? 'Pause' : timer.remaining === timer.total ? 'Start' : 'Resume';
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === timer.mode));
  $('#session-count').textContent = `${plural(sessions, 'session')} completed · a long break every 4th`;
}
setInterval(updateTimer, 250);

function timerPage() {
  const length = 2 * Math.PI * 140;
  render(pageHead('FOCUS', 'One task. Full focus.', 'Work in focused blocks with short breaks between. The timer keeps running while you use the rest of the site.') + `
    <section class="panel timer-panel">
      <div class="segmented" role="group" aria-label="Timer mode">${Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}">${m.label}</button>`).join('')}</div>
      <div class="ring" role="timer" aria-live="off">
        <svg viewBox="0 0 300 300" aria-hidden="true">
          <defs><linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6bff"/><stop offset="1" stop-color="#14b4dc"/></linearGradient></defs>
          <circle class="track" cx="150" cy="150" r="140"/>
          <circle class="bar" id="ring-bar" cx="150" cy="150" r="140" stroke-dasharray="${length}" stroke-dashoffset="0"/>
        </svg>
        <div class="ring-label"><strong id="ring-time">25:00</strong><small id="ring-mode">Focus</small></div>
      </div>
      <div class="actions"><button class="button primary big" id="timer-toggle">Start</button><button class="button big" id="timer-reset">Reset</button></div>
      <label class="custom-minutes">Focus length <input type="number" id="focus-minutes" min="1" max="120" value="${MODES.focus.minutes()}"> minutes</label>
      <label class="switch"><input type="checkbox" id="sound" ${read('CR_SOUND', true) ? 'checked' : ''}> Play a chime when time’s up</label>
      <p class="help" id="session-count"></p>
    </section>`);
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#timer-toggle').onclick = () => {
    if (timer.running) { timer.remaining = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000)); timer.running = false; }
    else { if (!timer.remaining) timer.remaining = timer.total; timer.end = Date.now() + timer.remaining * 1000; timer.running = true; }
    updateTimer();
  };
  $('#timer-reset').onclick = () => setMode(timer.mode);
  $('#focus-minutes').onchange = e => {
    const minutes = Math.min(120, Math.max(1, Math.round(Number(e.target.value) || 25)));
    e.target.value = minutes; save('CR_FOCUS_MIN', minutes);
    if (timer.mode === 'focus' && !timer.running) setMode('focus');
  };
  $('#sound').onchange = e => save('CR_SOUND', e.target.checked);
  view.key = e => { if (e.key === ' ') { e.preventDefault(); $('#timer-toggle').click(); } };
  updateTimer();
}

/* ---------- Community chat ---------- */

function chat() {
  render(pageHead('COMMUNITY', 'Better, together.', 'Ask a question, share a tip or cheer someone on. Messages are public, so be kind.') + `
    <section class="panel">
      <div class="chat-box" id="chat-box" aria-label="Messages" aria-live="polite"><div class="empty">Loading messages…</div></div>
      ${user ? `<form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">Message</label><input id="chat-input" maxlength="2000" autocomplete="off" placeholder="Message as ${esc(user.username)}…"><button class="button primary" id="send">Send</button></form>`
        : `<div class="notice"><span>Sign in to join the conversation.</span><a class="button small primary" href="#account">Sign in</a></div>`}
      <p class="help" id="chat-status"></p>
    </section>`);
  let busy = false, lastId = '';
  const refresh = async () => {
    if (busy) return; busy = true;
    try {
      const messages = await request('/api/chat');
      if (page !== 'chat' || !Array.isArray(messages)) return;
      const newest = messages.at(-1)?.id || '';
      if (newest !== lastId) {
        const box = $('#chat-box'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80 || !lastId;
        box.innerHTML = messages.length ? messages.map(m => `<article class="msg ${user && m.author === user.username ? 'mine' : ''}"><header><strong>${esc(m.author)}</strong><time>${esc(new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time></header><p>${esc(m.text)}</p></article>`).join('')
          : '<div class="empty"><strong>No messages yet.</strong>Say hello and start the conversation.</div>';
        if (atBottom) box.scrollTop = box.scrollHeight;
        lastId = newest;
      }
      $('#chat-status').textContent = 'Live · updates every few seconds';
    } catch { if (page === 'chat') $('#chat-status').textContent = 'Chat can’t be reached right now. Retrying…'; }
    finally { busy = false; }
  };
  refresh();
  const poll = setInterval(refresh, 5000);
  view.cleanup = () => clearInterval(poll);
  const form = $('#chat-form');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const input = $('#chat-input'), text = input.value.trim();
    if (!text) return;
    $('#send').disabled = true;
    try { await post('/api/chat', { text }); input.value = ''; lastId = ''; await refresh(); }
    catch (error) { toast(error.message, 'bad'); }
    finally { $('#send').disabled = false; input.focus(); }
  };
}

/* ---------- Account ---------- */

async function loadAccount() {
  try { user = (await request('/api/auth/me'))?.user || null; }
  catch { user = null; }
  updateUser();
  if (page === 'account' || page === 'home') route();
}

function account() {
  if (user) {
    const published = remoteSets.filter(s => s.ownerId === user.id).length;
    render(pageHead('ACCOUNT', 'Your space.', '') + `
      <section class="panel"><div class="profile-head"><span class="avatar">${esc(user.username[0].toUpperCase())}</span><div><h2>${esc(user.username)}</h2><p class="help">Signed in</p></div></div>
        <div class="stats">
          <div class="stat"><div><strong>${streak()}</strong><small>Day streak</small></div></div>
          <div class="stat"><div><strong>${published}</strong><small>Sets published</small></div></div>
          <div class="stat"><div><strong>${localSets.length}</strong><small>Sets on this device</small></div></div>
          <div class="stat"><div><strong>${sessions}</strong><small>Focus sessions</small></div></div>
        </div>
      </section>
      ${backupPanel()}
      <section class="panel danger-zone"><div><h3>Sign out</h3><p class="help">Your sets and progress stay on this device.</p></div><button class="button danger" id="logout">Sign out</button></section>`);
    $('#logout').onclick = async () => {
      try { await post('/api/auth/logout'); } catch { /* signed out locally either way */ }
      user = null; updateUser(); toast('Signed out.'); route();
    };
    wireBackup();
    return;
  }
  const mode = account.mode || 'login';
  render(pageHead('ACCOUNT', mode === 'login' ? 'Welcome back.' : 'Join CyberRevision.', 'An account lets you publish sets and chat. Studying works without one.') + `
    <section class="panel auth">
      <div class="segmented" role="tablist"><button data-auth="login" class="${mode === 'login' ? 'active' : ''}">Sign in</button><button data-auth="register" class="${mode === 'register' ? 'active' : ''}">Create account</button></div>
      <form id="auth-form" novalidate>
        <label class="field"><span>Username</span><input id="auth-username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username" placeholder="Letters, numbers and underscores"></label>
        <label class="field"><span>Password</span><span class="password"><input id="auth-password" type="password" required minlength="12" maxlength="128" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="At least 12 characters"><button type="button" id="show-password">Show</button></span></label>
        ${mode === 'register' ? '<p class="help">There’s no password reset yet, so use a password manager or write it somewhere safe.</p>' : ''}
        <p class="error" id="auth-error" role="alert"></p>
        <button class="button primary big" id="auth-submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </section>
    ${backupPanel()}`);
  $$('[data-auth]').forEach(b => b.onclick = () => { account.mode = b.dataset.auth; route(); });
  $('#show-password').onclick = () => { const p = $('#auth-password'); const show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('#show-password').textContent = show ? 'Hide' : 'Show'; };
  $('#auth-username').focus();
  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const username = $('#auth-username').value.trim(), password = $('#auth-password').value, error = $('#auth-error');
    error.textContent = '';
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return error.textContent = 'Usernames are 3–24 letters, numbers or underscores.';
    if (password.length < 12) return error.textContent = 'Passwords need at least 12 characters.';
    const button = $('#auth-submit'); button.disabled = true;
    try {
      user = (await post('/api/auth/' + mode, { username, password })).user;
      updateUser();
      toast(mode === 'login' ? `Welcome back, ${user.username}!` : `Welcome, ${user.username}!`, 'good');
      loadSets();
      go('home');
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; }
  };
  wireBackup();
}

function backupPanel() {
  return `<section class="panel"><h3>Back up this device</h3><p class="help">Download your sets, progress, plan and streak as a file, then load it on another computer.</p>
    <div class="actions"><button class="button" id="backup-export">Download backup</button><label class="button">Load backup<input type="file" id="backup-import" accept="application/json,.json" hidden></label></div></section>`;
}
const BACKUP_KEYS = ['CR_SETS', 'CR_TASKS', 'CR_SESSIONS', 'CR_BEST', 'CR_PROGRESS', 'CR_ACTIVITY', 'CR_FOCUS_MIN'];
function wireBackup() {
  $('#backup-export').onclick = () => {
    const data = { app: 'CyberRevision', version: 1, saved: new Date().toISOString(), data: Object.fromEntries(BACKUP_KEYS.map(k => [k, read(k, null)])) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `cyberrevision-backup-${dayKey()}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#backup-import').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.app !== 'CyberRevision' || typeof parsed.data !== 'object') throw new Error();
      if (!confirm('Replace the sets, progress and plan on this device with the backup?')) return;
      for (const k of BACKUP_KEYS) if (parsed.data[k] !== null && parsed.data[k] !== undefined) save(k, parsed.data[k]);
      toast('Backup loaded. Reloading…', 'good');
      setTimeout(() => location.reload(), 800);
    } catch { toast('That file isn’t a CyberRevision backup.', 'bad'); }
  };
}

/* ---------- Start ---------- */

function splash() { // the Blender-rendered intro, once per browser session
  const el = $('#splash');
  let seen = true;
  try { seen = sessionStorage.getItem('CR_SPLASH') === '1'; sessionStorage.setItem('CR_SPLASH', '1'); } catch { /* storage blocked */ }
  if (seen || calm()) return el.remove();
  el.hidden = false;
  const video = $('#splash-video');
  let gone = false;
  const hide = () => {
    if (gone) return; gone = true;
    el.classList.add('out');
    document.body.classList.add('reveal');
    setTimeout(() => { el.remove(); document.body.classList.remove('reveal'); }, 600);
  };
  video.addEventListener('ended', hide);
  video.addEventListener('error', hide);
  el.addEventListener('click', hide);
  video.play().catch(hide);
  setTimeout(hide, 4000);
}


document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (e.target.closest?.('button, a, label') && (e.key === ' ' || e.key === 'Enter')) return; // let the focused control handle it
  view.key?.(e);
});
$('#theme-toggle').onclick = toggleTheme;
$('#theme-toggle-mobile').onclick = toggleTheme;
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
window.addEventListener('hashchange', route);
splash();
applyTheme();
updateUser();
updateStreak();
route();
loadSets();
loadAccount();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
