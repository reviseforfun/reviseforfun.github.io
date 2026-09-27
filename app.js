'use strict';

// --- Configuration ---
const API_BASE_URL = 'https://cyber.reviseio.workers.dev';

const STORAGE_KEYS = {
  SETS: 'CR_SETS',
  TASKS: 'CR_TASKS',
  SESSIONS: 'CR_SESSIONS'
};

// --- Application State ---
const state = {
  user: null,
  localSets: [],
  remoteSets: [],
  tasks: [],
  sessions: 0,
  chatMessages: [],
  activeSet: null,
  studyMode: 'flashcards',
  currentCardIndex: 0,
  isFlipped: false
};

// --- Storage Helpers ---
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

// --- Utilities ---
function esc(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

// --- API Network Request Helper ---
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const config = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Mandated for session management with Cloudflare Workers
    signal: AbortSignal.timeout(15000),
    ...options
  };

  try {
    const res = await fetch(url, config);
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

// --- App Initialization ---
async function initApp() {
  state.localSets = readStorage(STORAGE_KEYS.SETS, []);
  state.tasks = readStorage(STORAGE_KEYS.TASKS, []);
  state.sessions = readStorage(STORAGE_KEYS.SESSIONS, 0);

  // Authenticate session and load remote sets before initial render
  await checkAccountSession();
  await fetchRemoteSets();

  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  // Poll chat every 5 seconds
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

// --- Authentication Handlers ---
async function handleAuthSubmit(event, endpoint) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const user = await request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    state.user = user;
    renderAccountBar();
    handleRoute();
    toast('Success!');
  } catch (err) {
    toast(err.message || 'Authentication failed.');
  }
}

async function signOut() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout error:', err);
  }
  state.user = null;
  renderAccountBar();
  handleRoute();
  toast('Signed out.');
}

// --- Chat Handlers ---
async function sendChatMessage(event) {
  event.preventDefault();
  const input = document.getElementById('chat-input');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  try {
    await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    input.value = '';
    await refreshChat();
  } catch (err) {
    toast('Failed to send message.');
  }
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
    // Silent failure for polling loop
  }
}

// --- Router ---
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
      renderLibrary(mainContent);
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

// --- Views ---
function renderLibrary(container) {
  const sets = getAllSets();
  container.innerHTML = `
    <section class="library-section">
      <h2>Study Library</h2>
      <div id="set-grid" class="set-grid">
        ${sets.map(set => `
          <div class="set-card">
            <h3>${esc(set.title)}</h3>
            <p>Subject: ${esc(set.subject || 'General')}</p>
            <p>${set.cards ? set.cards.length : 0} cards</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderPlanner(container) {
  container.innerHTML = `
    <section class="planner-section">
      <h2>Revision Planner</h2>
      <ul>
        ${state.tasks.map(task => `<li>${esc(task.text)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderTimer(container) {
  container.innerHTML = `
    <section class="timer-section">
      <h2>Focus Timer</h2>
      <div class="timer-display">25:00</div>
      <p>Completed Sessions: ${state.sessions}</p>
    </section>
  `;
}

function renderChat(container) {
  container.innerHTML = `
    <section class="chat-section">
      <h2>Community Chat</h2>
      <div id="chat-box" class="chat-box"></div>
      ${state.user 
        ? `<form id="chat-form">
             <input type="text" id="chat-input" placeholder="Say something..." required>
             <button type="submit">Send</button>
           </form>`
        : '<p>Please <a href="#account">sign in</a> to chat.</p>'
      }
    </section>
  `;

  const chatForm = document.getElementById('chat-form');
  if (chatForm) {
    chatForm.addEventListener('submit', sendChatMessage);
  }

  refreshChat();
}

function renderAccountPage(container) {
  if (state.user) {
    container.innerHTML = `
      <section class="account-section">
        <h2>Account Profile</h2>
        <p>Signed in as <strong>${esc(state.user.username)}</strong></p>
        <button id="signout-btn">Sign Out</button>
      </section>
    `;
    document.getElementById('signout-btn').addEventListener('click', signOut);
    return;
  }

  container.innerHTML = `
    <section class="account-section">
      <h2>Sign In</h2>
      <form id="login-form">
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Sign In</button>
      </form>
    </section>
  `;

  document.getElementById('login-form').addEventListener('submit', (e) => {
    handleAuthSubmit(e, '/api/auth/login');
  });
}

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
