// server/routes/rounds.js
// Covers: rounds, players, holes, specials, reactions, stroke indexes, stats/settlement
const express     = require('express');
const router      = express.Router();
const { query }   = require('../config/db');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// ── Validation helpers ─────────────────────────────────────────────────────
function isValidHole(n) { return Number.isInteger(Number(n)) && n >= 1 && n <= 18; }
function isValidStrokes(n) { return Number.isInteger(Number(n)) && n >= 1 && n <= 30; }
function isValidPointValue(v) { return !isNaN(v) && v >= 0.5 && v <= 100; }

// ── Rounds ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, u.name AS created_by_name
       FROM rounds r
       JOIN users u ON u.id = r.created_by
       WHERE r.created_by = $1
          OR r.id IN (SELECT round_id FROM round_players WHERE user_id = $1)
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id([0-9]+)', async (req, res, next) => {
  try {
    const { id } = req.params;
    const round = await query('SELECT * FROM rounds WHERE id = $1', [id]);
    if (!round.rows.length) return res.status(404).json({ message: 'Round not found' });

    const [players, games] = await Promise.all([
      query(
        `SELECT rp.*, u.name AS user_name, u.email
         FROM round_players rp
         LEFT JOIN users u ON u.id = rp.user_id
         WHERE rp.round_id = $1`,
        [id]
      ),
      query('SELECT * FROM round_games WHERE round_id = $1', [id]),
    ]);

    res.json({ ...round.rows[0], players: players.rows, games: games.rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, course_name, holes = 18, slope_rating, course_rating, par_total, tee_name } = req.body;
    const result = await query(
      `INSERT INTO rounds (name, course_name, created_by, holes, slope_rating, course_rating, par_total, tee_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, course_name, req.user.id, holes, slope_rating || null, course_rating || null, par_total || 72, tee_name || null]
    );
    const round = result.rows[0];
    await query('INSERT INTO round_players (round_id, user_id) VALUES ($1, $2)', [round.id, req.user.id]);
    res.status(201).json(round);
  } catch (err) { next(err); }
});

router.patch('/:id([0-9]+)', async (req, res, next) => {
  try {
    const { name, course_name, status } = req.body;
    const result = await query(
      `UPDATE rounds SET
         name         = COALESCE($1, name),
         course_name  = COALESCE($2, course_name),
         status       = COALESCE($3, status),
         completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = $4 AND created_by = $5 RETURNING *`,
      [name, course_name, status, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Round not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id([0-9]+)', async (req, res, next) => {
  try {
    await query('DELETE FROM rounds WHERE id = $1 AND created_by = $2', [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.put('/:id([0-9]+)/games', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { games } = req.body;
    await query('DELETE FROM round_games WHERE round_id = $1', [id]);
    if (games?.length) {
      for (const g of games) {
        const val = g.point_value ?? 1;
        if (!isValidPointValue(val))
          return res.status(400).json({ message: `Invalid point value: ${val}` });
        await query(
          'INSERT INTO round_games (round_id, game_type, point_value, custom_name) VALUES ($1, $2, $3, $4)',
          [id, g.game_type, val, g.custom_name ?? null]
        );
      }
    }
    const result = await query('SELECT * FROM round_games WHERE round_id = $1', [id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── Players ────────────────────────────────────────────────────────────────
router.post('/:round_id([0-9]+)/players', async (req, res, next) => {
  try {
    const { round_id } = req.params;
    const { user_id, guest_name, color, handicap_index } = req.body;
    if (!user_id && !guest_name)
      return res.status(400).json({ message: 'user_id or guest_name required' });

    const result = await query(
      `INSERT INTO round_players (round_id, user_id, guest_name, color, handicap_index)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (round_id, user_id) DO NOTHING RETURNING *`,
      [round_id, user_id ?? null, guest_name ?? null, color ?? null, handicap_index ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/players/:id([0-9]+)', async (req, res, next) => {
  try {
    const { color, handicap_index } = req.body;
    const result = await query(
      `UPDATE round_players SET
         color          = COALESCE($1, color),
         handicap_index = COALESCE($2, handicap_index)
       WHERE id = $3 RETURNING *`,
      [color, handicap_index, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/players/:id([0-9]+)', async (req, res, next) => {
  try {
    await query('DELETE FROM round_players WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Hole scores ────────────────────────────────────────────────────────────
router.get('/:round_id([0-9]+)/holes', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM hole_scores WHERE round_id = $1 ORDER BY hole_number, round_player_id',
      [req.params.round_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:round_id([0-9]+)/holes', async (req, res, next) => {
  try {
    const { round_player_id, hole_number, strokes, par } = req.body;
    if (!isValidHole(hole_number))
      return res.status(400).json({ message: 'hole_number must be between 1 and 18' });
    if (!isValidStrokes(strokes))
      return res.status(400).json({ message: 'strokes must be between 1 and 30' });
    if (![3,4,5].includes(Number(par)))
      return res.status(400).json({ message: 'par must be 3, 4, or 5' });
    const result = await query(
      `INSERT INTO hole_scores (round_id, round_player_id, hole_number, strokes, par)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (round_id, round_player_id, hole_number)
       DO UPDATE SET strokes = EXCLUDED.strokes, par = EXCLUDED.par RETURNING *`,
      [req.params.round_id, round_player_id, hole_number, strokes, par]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ── Specials ───────────────────────────────────────────────────────────────
router.get('/:round_id([0-9]+)/specials', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, rg.game_type, rg.point_value, rg.custom_name,
              rp.user_id, rp.guest_name, u.name AS user_name
       FROM specials s
       JOIN round_games rg   ON rg.id = s.round_game_id
       JOIN round_players rp ON rp.id = s.round_player_id
       LEFT JOIN users u     ON u.id  = rp.user_id
       WHERE s.round_id = $1
       ORDER BY s.hole_number, s.logged_at`,
      [req.params.round_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:round_id([0-9]+)/specials', async (req, res, next) => {
  try {
    const { round_player_id, round_game_id, hole_number } = req.body;
    if (!round_player_id || !round_game_id || !hole_number)
      return res.status(400).json({ message: 'round_player_id, round_game_id, and hole_number are required' });

    const result = await query(
      'INSERT INTO specials (round_id, round_player_id, round_game_id, hole_number) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.round_id, round_player_id, round_game_id, hole_number]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/specials/:id([0-9]+)', async (req, res, next) => {
  try {
    await query('DELETE FROM specials WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Reactions ──────────────────────────────────────────────────────────────
const VALID_REACTIONS = ['great', 'disaster', 'lucky', 'clutch', 'embarrassing'];

router.get('/:round_id([0-9]+)/reactions', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT hr.*, rp.user_id, rp.guest_name, u.name AS user_name
       FROM hole_reactions hr
       JOIN round_players rp ON rp.id = hr.round_player_id
       LEFT JOIN users u ON u.id = rp.user_id
       WHERE hr.round_id = $1
       ORDER BY hr.hole_number, hr.logged_at`,
      [req.params.round_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:round_id([0-9]+)/reactions', async (req, res, next) => {
  try {
    const { round_player_id, hole_number, reaction } = req.body;
    if (!VALID_REACTIONS.includes(reaction))
      return res.status(400).json({ message: `reaction must be one of: ${VALID_REACTIONS.join(', ')}` });

    const result = await query(
      `INSERT INTO hole_reactions (round_id, round_player_id, hole_number, reaction)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (round_id, round_player_id, hole_number, reaction) DO NOTHING RETURNING *`,
      [req.params.round_id, round_player_id, hole_number, reaction]
    );
    res.status(201).json(result.rows[0] || { already_logged: true });
  } catch (err) { next(err); }
});

router.delete('/:round_id([0-9]+)/reactions', async (req, res, next) => {
  try {
    const { round_player_id, hole_number, reaction } = req.body;
    await query(
      'DELETE FROM hole_reactions WHERE round_id=$1 AND round_player_id=$2 AND hole_number=$3 AND reaction=$4',
      [req.params.round_id, round_player_id, hole_number, reaction]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Stroke indexes ─────────────────────────────────────────────────────────
const DEFAULT_STROKE_INDEXES = [
  { hole_number: 1,  par: 4, stroke_index: 7  },
  { hole_number: 2,  par: 4, stroke_index: 11 },
  { hole_number: 3,  par: 3, stroke_index: 15 },
  { hole_number: 4,  par: 5, stroke_index: 3  },
  { hole_number: 5,  par: 4, stroke_index: 1  },
  { hole_number: 6,  par: 4, stroke_index: 13 },
  { hole_number: 7,  par: 3, stroke_index: 17 },
  { hole_number: 8,  par: 5, stroke_index: 5  },
  { hole_number: 9,  par: 4, stroke_index: 9  },
  { hole_number: 10, par: 4, stroke_index: 8  },
  { hole_number: 11, par: 4, stroke_index: 10 },
  { hole_number: 12, par: 3, stroke_index: 16 },
  { hole_number: 13, par: 5, stroke_index: 4  },
  { hole_number: 14, par: 4, stroke_index: 2  },
  { hole_number: 15, par: 4, stroke_index: 14 },
  { hole_number: 16, par: 3, stroke_index: 18 },
  { hole_number: 17, par: 5, stroke_index: 6  },
  { hole_number: 18, par: 4, stroke_index: 12 },
];

router.get('/:round_id([0-9]+)/stroke-indexes', async (req, res, next) => {
  try {
    const { round_id } = req.params;
    const result = await query(
      'SELECT * FROM hole_stroke_indexes WHERE round_id = $1 ORDER BY hole_number',
      [round_id]
    );
    res.json(result.rows.length
      ? result.rows
      : DEFAULT_STROKE_INDEXES.map(d => ({ ...d, round_id: parseInt(round_id) }))
    );
  } catch (err) { next(err); }
});

router.put('/:round_id([0-9]+)/stroke-indexes', async (req, res, next) => {
  try {
    const { round_id } = req.params;
    const { holes } = req.body;
    if (!Array.isArray(holes) || !holes.length)
      return res.status(400).json({ message: 'holes array required' });

    for (const h of holes) {
      await query(
        `INSERT INTO hole_stroke_indexes (round_id, hole_number, par, stroke_index)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (round_id, hole_number)
         DO UPDATE SET par = EXCLUDED.par, stroke_index = EXCLUDED.stroke_index`,
        [round_id, h.hole_number, h.par, h.stroke_index]
      );
    }
    const result = await query(
      'SELECT * FROM hole_stroke_indexes WHERE round_id = $1 ORDER BY hole_number',
      [round_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── Stats / Settlement ─────────────────────────────────────────────────────
router.get('/stats/me', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rounds, specials, earnings] = await Promise.all([
      query('SELECT COUNT(DISTINCT round_id) AS total_rounds FROM round_players WHERE user_id = $1', [userId]),
      query(
        `SELECT rg.game_type, COUNT(*) AS count
         FROM specials s
         JOIN round_games rg   ON rg.id = s.round_game_id
         JOIN round_players rp ON rp.id = s.round_player_id
         WHERE rp.user_id = $1
         GROUP BY rg.game_type ORDER BY count DESC`,
        [userId]
      ),
      query(
        `SELECT SUM(
           CASE WHEN rp.user_id = $1
             THEN rg.point_value * ((SELECT COUNT(*) FROM round_players rp2 WHERE rp2.round_id = s.round_id) - 1)
             ELSE -rg.point_value
           END
         ) AS total_earnings
         FROM specials s
         JOIN round_games rg    ON rg.id  = s.round_game_id
         JOIN round_players rp  ON rp.id  = s.round_player_id
         JOIN round_players rp2 ON rp2.round_id = s.round_id AND rp2.user_id = $1
         WHERE s.round_id IN (SELECT round_id FROM round_players WHERE user_id = $1)`,
        [userId]
      ),
    ]);
    res.json({
      totalRounds:    parseInt(rounds.rows[0].total_rounds),
      specialsCounts: specials.rows,
      totalEarnings:  parseFloat(earnings.rows[0]?.total_earnings || 0).toFixed(2),
    });
  } catch (err) { next(err); }
});

router.get('/:round_id([0-9]+)/settlement', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*,
         fp.user_id AS from_user_id, fp.guest_name AS from_guest, uf.name AS from_name,
         tp.user_id AS to_user_id,   tp.guest_name AS to_guest,   ut.name AS to_name
       FROM settlements s
       JOIN round_players fp ON fp.id = s.from_player
       JOIN round_players tp ON tp.id = s.to_player
       LEFT JOIN users uf ON uf.id = fp.user_id
       LEFT JOIN users ut ON ut.id = tp.user_id
       WHERE s.round_id = $1`,
      [req.params.round_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:round_id([0-9]+)/settlement', async (req, res, next) => {
  try {
    const { round_id } = req.params;
    const { settlements } = req.body;
    await query('DELETE FROM settlements WHERE round_id = $1', [round_id]);
    for (const s of settlements) {
      await query(
        `INSERT INTO settlements (round_id, from_player, to_player, amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (round_id, from_player, to_player) DO UPDATE SET amount = EXCLUDED.amount`,
        [round_id, s.from_player, s.to_player, s.amount]
      );
    }
    res.status(201).json({ saved: settlements.length });
  } catch (err) { next(err); }
});

module.exports = router;
