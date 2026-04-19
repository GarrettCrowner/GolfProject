// server/routes/users.js
// Covers: auth, friends, push subscriptions
const express     = require('express');
const router      = express.Router();
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const webpush     = require('web-push');
const { query }   = require('../config/db');
const requireAuth = require('../middleware/auth');

// ── VAPID setup ────────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@skinsapp.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Exported so ws/roundSync.js can call it without a circular dep
async function notifyRound(roundId, excludeUserId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const result = await query(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN round_players rp ON rp.user_id = ps.user_id
       WHERE rp.round_id = $1 AND ps.user_id != $2`,
      [roundId, excludeUserId || 0]
    );
    await Promise.allSettled(
      result.rows.map(row =>
        webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload)
        ).catch(err => {
          if (err.statusCode === 410)
            query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]).catch(() => {});
        })
      )
    );
  } catch (err) { console.error('Push notification error:', err); }
}

// ── Auth helpers ───────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── Auth routes ────────────────────────────────────────────────────────────
router.post('/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'name, email, and password are required' });

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length)
      return res.status(409).json({ message: 'Email already in use' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'email and password are required' });

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
});

router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ── Friends routes ─────────────────────────────────────────────────────────
router.get('/friends', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY u.name`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/friends', requireAuth, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'email required' });

    const found = await query('SELECT id, name, email FROM users WHERE email = $1', [email]);
    if (!found.rows.length) return res.status(404).json({ message: 'User not found' });

    const friend = found.rows[0];
    if (friend.id === req.user.id)
      return res.status(400).json({ message: "You can't friend yourself" });

    await query(
      `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
      [req.user.id, friend.id]
    );
    res.status(201).json(friend);
  } catch (err) { next(err); }
});

router.delete('/friends/:id', requireAuth, async (req, res, next) => {
  try {
    await query(
      'DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)',
      [req.user.id, req.params.id]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Push routes ────────────────────────────────────────────────────────────
router.get('/push/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/push/subscribe', requireAuth, async (req, res, next) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ message: 'subscription required' });

    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()`,
      [req.user.id, subscription.endpoint, subscription.keys?.p256dh, subscription.keys?.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/push/unsubscribe', requireAuth, async (req, res, next) => {
  try {
    await query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, req.body.endpoint]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.notifyRound = notifyRound;
