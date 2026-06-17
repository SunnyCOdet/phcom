// Authentication for pcphone.
//
// Open self-registration: anyone who can reach the page may create an account,
// then must log in before any control/streaming is allowed. Passwords are
// hashed with scrypt (Node built-in crypto — no native deps). Users and
// sessions are persisted to a JSON file in Electron's userData dir so logins
// survive restarts.
//
// NOTE: open registration means anyone who reaches your URL can register.
// `setRegistrationOpen(false)` lets you lock it down after creating accounts.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

let storePath = null;
let store = { users: {}, sessions: {}, registrationOpen: true };

/** Resolve the on-disk store path (Electron userData, with a temp fallback). */
function resolveStorePath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'pcphone-auth.json');
  } catch (err) {
    return path.join(os.tmpdir(), 'pcphone-auth.json');
  }
}

function load() {
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      store = {
        users: parsed.users || {},
        sessions: parsed.sessions || {},
        registrationOpen: parsed.registrationOpen !== false,
      };
    }
  } catch (err) {
    console.error('[auth] Failed to load store, starting fresh:', err.message);
    store = { users: {}, sessions: {}, registrationOpen: true };
  }
  pruneExpiredSessions();
}

function save() {
  try {
    fs.writeFileSync(storePath, JSON.stringify(store), 'utf8');
  } catch (err) {
    console.error('[auth] Failed to persist store:', err.message);
  }
}

/** Initialize the auth store. Call once after the Electron app is ready. */
function init() {
  storePath = resolveStorePath();
  load();
  console.log(`[auth] Initialized. Users: ${Object.keys(store.users).length} | Registration ${store.registrationOpen ? 'OPEN' : 'CLOSED'} | Store: ${storePath}`);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of Object.entries(store.sessions)) {
    if (!session || session.expiresAt <= now) {
      delete store.sessions[token];
      changed = true;
    }
  }
  if (changed) save();
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  store.sessions[token] = { username, expiresAt: Date.now() + SESSION_TTL_MS };
  save();
  return token;
}

/**
 * Register a new user.
 * @returns {{ ok: boolean, token?: string, message?: string }}
 */
function register(username, password) {
  if (!store.registrationOpen) {
    return { ok: false, message: 'Registration is closed' };
  }
  const name = normalizeUsername(username);
  if (name.length < MIN_USERNAME) {
    return { ok: false, message: `Username must be at least ${MIN_USERNAME} characters` };
  }
  if (String(password || '').length < MIN_PASSWORD) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD} characters` };
  }
  if (store.users[name]) {
    return { ok: false, message: 'Username already taken' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  store.users[name] = { salt, hash: hashPassword(password, salt), createdAt: Date.now() };
  save();
  console.log(`[auth] Registered new user: ${name}`);
  const token = createSession(name);
  return { ok: true, token, username: name };
}

/**
 * Log a user in.
 * @returns {{ ok: boolean, token?: string, message?: string }}
 */
function login(username, password) {
  const name = normalizeUsername(username);
  const user = store.users[name];
  if (!user) {
    return { ok: false, message: 'Invalid username or password' };
  }
  const candidate = hashPassword(password, user.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, message: 'Invalid username or password' };
  }
  console.log(`[auth] Login: ${name}`);
  const token = createSession(name);
  return { ok: true, token, username: name };
}

/** Invalidate a session token. */
function logout(token) {
  if (token && store.sessions[token]) {
    delete store.sessions[token];
    save();
  }
}

/**
 * Verify a session token.
 * @returns {string|null} username if valid, else null
 */
function verifyToken(token) {
  if (!token) return null;
  const session = store.sessions[token];
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    delete store.sessions[token];
    save();
    return null;
  }
  return session.username;
}

function getUserCount() {
  return Object.keys(store.users).length;
}

function isRegistrationOpen() {
  return store.registrationOpen !== false;
}

function setRegistrationOpen(open) {
  store.registrationOpen = !!open;
  save();
  return store.registrationOpen;
}

/** Express middleware that rejects requests without a valid Bearer token. */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  const username = verifyToken(token);
  if (!username) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  req.username = username;
  next();
}

/** Pull a token from the Authorization header or a `token` query param. */
function extractToken(req) {
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token);
  }
  return null;
}

module.exports = {
  init,
  register,
  login,
  logout,
  verifyToken,
  requireAuth,
  extractToken,
  getUserCount,
  isRegistrationOpen,
  setRegistrationOpen,
};
