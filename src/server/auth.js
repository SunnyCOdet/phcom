// Authentication for pcphone — backed by Supabase Auth.
//
// The old local scrypt/JSON store has been replaced: every control path now
// requires a valid Supabase access token (JWT). Phones and the desktop host all
// sign in against Supabase Auth; the token is verified here against the Supabase
// Auth API. A short in-memory cache avoids a network round-trip on every call.

const supabaseConfig = require('./supabase-config');

const TOKEN_CACHE_TTL_MS = 60 * 1000; // re-validate at most once a minute per token
const cache = new Map(); // token -> { username, expiresAt }

/** Kept for API compatibility with the previous local store. */
function init() {
  console.log(`[auth] Using Supabase Auth. Project: ${supabaseConfig.SUPABASE_URL}`);
}

/**
 * Verify a Supabase access token by resolving the user it belongs to.
 * @param {string} token - Supabase JWT (access_token)
 * @returns {Promise<string|null>} the user's email/id if valid, else null
 */
async function verifyToken(token) {
  if (!token) return null;

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.username;

  try {
    const res = await fetch(`${supabaseConfig.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: supabaseConfig.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      cache.delete(token);
      return null;
    }
    const user = await res.json();
    const username = user.email || user.id;
    if (!username) return null;
    cache.set(token, { username, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return username;
  } catch (err) {
    console.error('[auth] verifyToken error:', err.message);
    return null;
  }
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

/** Express middleware that rejects requests without a valid Supabase token. */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  const username = await verifyToken(token);
  if (!username) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  req.username = username;
  next();
}

module.exports = {
  init,
  verifyToken,
  requireAuth,
  extractToken,
  supabaseConfig,
};
