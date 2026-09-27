'use strict';

// --- State Management & Persistence ---
const STORAGE_KEYS = {
  SETS: 'CR_SETS',
  TASKS: 'CR_TASKS',
  SESSIONS: 'CR_SESSIONS'
};

const state = {
  user: null,
  localSets: [],
  remoteSets: [],
  tasks: [],
  sessions: 0,
  chatMessages: [],
  activeSet: null,
  studyMode: 'flashcards', // 'flashcards' | 'quiz'
  currentCardIndex: 0,
  isFlipped: false,
  timer: {
    intervalId: null,
    timeLeft: 25 * 60,
    duration: 25 * 60,
    isRunning: false
  }
};

// Helper: Local Storage Read/Write
function readStorage(key, fallback) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (err) {
    toast('Unable to access local storage.');
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    toast('Failed to save data locally.');
  }
}

// Helper: HTML Escaping for XSS Prevention
function esc(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Toast Notifications
function toast(message) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const el = document.createElement('div');
  el.className = 'toast-message';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// --- API Network Wrapper ---
async function request(endpoint, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    ...options
  };

  try {
    const res = await fetch(endpoint, config);
    if (res.status === 401) {
      state.user = null;
      renderAccountBar();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Request failed (${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err.message);
    throw err;
  }
}

// --- Initialization ---
async function initApp() {
  // Load local persistence items
  state.localSets = readStorage(STORAGE_KEYS.SETS, []);
  state.tasks = readStorage(STORAGE_KEYS.TASKS, []);
  state.sessions = readStorage(STORAGE_KEYS.SESSIONS, 0);

  // Authenticate session before initial rendering to prevent flash of guest state
  await checkAccountSession();
  await fetchRemoteSets();

  // Setup routing & start periodic processes
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
  
  // Start chat polling loop
  setInterval(refreshChat, 5000);
}

async function checkAccountSession() {
  try {
    const user = await request('/api/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  renderAccountBar();
}

async function fetchRemoteSets() {
  try {
    state.remoteSets = await request('/api/sets');
  } catch {
    state.remoteSets = [];
  }
}

// Combined Sets List
function getAllSets() {
  const builtInSamples = [
    {
      id: 'sample-1',
      title: 'Biology 101: Cell Structure',
      subject: 'Biology',
      cards: [
        { term: 'Mitochondria', definition: 'Powerhouse of the cell, produces ATP.' },
        { term: 'Ribosome', definition: 'Synthesizes proteins from amino acids.' }
      ]
    }
  ];
  return [...builtInSamples, ...state.localSets, ...state.remoteSets];
}

// --- Quiz Logic with Improved Normalization ---
function normalizeAnswer(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/gi, '') // Remove punctuation, retain single spaces
    .replace(/\s+/g, ' ');    // Collapse multiple spaces into one
}

function checkAnswer(userAnswer, correctAnswer) {
  const cleanUser = normalizeAnswer(userAnswer);
  const cleanCorrect = normalizeAnswer(correctAnswer);
  return cleanUser === cleanCorrect;
}

// --- Routing & UI Rendering ---
function handleRoute() {
  const routePath = window.location.hash.replace('#', '') || 'library';
  const mainContent = document.getElementById('app-main');
  if (!mainContent) return;

  switch (routePath) {
    case 'library':
      renderLibrary(mainContent);
      break;
    case 'planner':
      renderPlanner(mainContent);
      break;
    case 'timer':
      renderTimer(mainContent);
      break;
    case 'chat':
      renderChat(mainContent);
      break;
    case 'account':
      renderAccountPage(mainContent);
      break;
    default:
      if (routePath.startsWith('study/')) {
        const setId = routePath.split('/')[1];
        renderStudyPage(mainContent, setId);
      } else {
        renderLibrary(mainContent);
      }
  }
}

function renderAccountBar() {
  const accountNav = document.getElementById('account-nav-item');
  if (!accountNav) return;

  if (state.user) {
    accountNav.innerHTML = `<a href="#account">Logged in as <strong>${esc(state.user.username)}</strong></a>`;
  } else {
    accountNav.innerHTML = `<a href="#account">Sign In / Register</a>`;
  }
}

// --- UI Components ---
function renderLibrary(container) {
  const sets = getAllSets();
  container.innerHTML = `
    <section class="library-section">
      <h2>Study Library</h2>
      <div class="library-controls">
        <input type="text" id="search-input" placeholder="Search study sets..." oninput="filterLibrary()">
      </div>
      <div id="set-grid" class="set-grid">
        ${renderSetList(sets)}
      </div>
    </section>
  `;
}

function renderSetList(sets) {
  if (sets.length === 0) {
    return '<p>No study sets found.</p>';
  }
  return sets.map(set => `
    <div class="set-card">
      <h3>${esc(set.title)}</h3>
      <p>Subject: ${esc(set.subject || 'General')}</p>
      <p>${set.cards ? set.cards.length : 0} cards</p>
      <button onclick="window.location.hash='study/${esc(set.id)}'">Study Set</button>
    </div>
  `).join('');
}

function renderPlanner(container) {
  container.innerHTML = `
    <section class="planner-section">
      <h2>Revision Planner</h2>
      <ul id="task-list">
        ${state.tasks.map((task, idx) => `
          <li>
            <span>${esc(task.text)}</span>
            <button onclick="removeTask(${idx})">Done</button>
          </li>
        `).join('')}
      </ul>
    </section>
  `;
}

function renderTimer(container) {
  container.innerHTML = `
    <section class="timer-section">
      <h2>Focus Timer</h2>
      <div class="timer-display" id="time-display">25:00</div>
      <button onclick="toggleTimer()">Start / Pause</button>
      <p>Completed Focus Sessions: ${state.sessions}</p>
    </section>
  `;
}

function renderChat(container) {
  container.innerHTML = `
    <section class="chat-section">
      <h2>Community Chat</h2>
      <div id="chat-box" class="chat-box"></div>
      ${state.user 
        ? `<form onsubmit="sendChatMessage(event)">
             <input type="text" id="chat-input" placeholder="Say something..." required>
             <button type="submit">Send</button>
           </form>`
        : '<p>Please <a href="#account">sign in</a> to participate in chat.</p>'
      }
    </section>
  `;
  refreshChat();
}

async function refreshChat() {
  const chatBox = document.getElementById('chat-box');
  if (!chatBox) return;

  try {
    const messages = await request('/api/chat');
    state.chatMessages = messages;
    chatBox.innerHTML = messages.map(msg => `
      <div class="chat-msg">
        <strong>${esc(msg.username)}:</strong> ${esc(msg.text)}
      </div>
    `).join('');
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch {
    // Silent fail for polling errors
  }
}

function renderAccountPage(container) {
  if (state.user) {
    container.innerHTML = `
      <section class="account-section">
        <h2>Account Profile</h2>
        <p>Signed in as <strong>${esc(state.user.username)}</strong></p>
        <button onclick="signOut()">Sign Out</button>
      </section>
    `;
    return;
  }

  container.innerHTML = `
    <section class="account-section">
      <h2>Account Sign In</h2>
      <form onsubmit="handleAuthSubmit(event, '/api/auth/login')">
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Sign In</button>
      </form>
    </section>
  `;
}

// --- App Startup ---
document.addEventListener('DOMContentLoaded', initApp);
