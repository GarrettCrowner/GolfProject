-- migrations/001_init.sql
-- Run this once against your skins_tracker database:
-- psql -U postgres -d skins_tracker -f migrations/001_init.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100)  NOT NULL,
  email       VARCHAR(255)  UNIQUE NOT NULL,
  password    VARCHAR(255)  NOT NULL,
  created_at  TIMESTAMP     DEFAULT NOW()
);

-- Friendships (bidirectional — both directions inserted)
CREATE TABLE IF NOT EXISTS friendships (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  friend_id   INT REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Rounds
CREATE TABLE IF NOT EXISTS rounds (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100),
  course_name   VARCHAR(255),
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20)  DEFAULT 'active',  -- active | completed
  holes         INT          DEFAULT 18,
  created_at    TIMESTAMP    DEFAULT NOW(),
  completed_at  TIMESTAMP
);

-- Players in a round (registered users or guests)
CREATE TABLE IF NOT EXISTS round_players (
  id              SERIAL PRIMARY KEY,
  round_id        INT REFERENCES rounds(id) ON DELETE CASCADE,
  user_id         INT REFERENCES users(id)  ON DELETE SET NULL,
  guest_name      VARCHAR(100),
  color           VARCHAR(20),
  handicap_index  DECIMAL(4,1),  -- e.g. 12.4
  UNIQUE(round_id, user_id)
);

-- Games configured for a round
CREATE TABLE IF NOT EXISTS round_games (
  id           SERIAL PRIMARY KEY,
  round_id     INT REFERENCES rounds(id) ON DELETE CASCADE,
  game_type    VARCHAR(50)   NOT NULL,   -- sandy | poley | barkie | greenie | splashy | birdie | eagle | stroke_play
  point_value  DECIMAL(6,2)  DEFAULT 1,
  custom_name  VARCHAR(100)
);

-- Hole stroke indexes (for handicap distribution)
-- One row per hole per round; stroke_index 1 = hardest hole
CREATE TABLE IF NOT EXISTS hole_stroke_indexes (
  id            SERIAL PRIMARY KEY,
  round_id      INT REFERENCES rounds(id) ON DELETE CASCADE,
  hole_number   INT NOT NULL,
  par           INT NOT NULL DEFAULT 4,
  stroke_index  INT NOT NULL,           -- 1–18
  UNIQUE(round_id, hole_number)
);

-- Hole-by-hole scores
CREATE TABLE IF NOT EXISTS hole_scores (
  id              SERIAL PRIMARY KEY,
  round_id        INT REFERENCES rounds(id)         ON DELETE CASCADE,
  round_player_id INT REFERENCES round_players(id)  ON DELETE CASCADE,
  hole_number     INT  NOT NULL,
  strokes         INT,
  par             INT,
  UNIQUE(round_id, round_player_id, hole_number)
);

-- Specials logged during a round
CREATE TABLE IF NOT EXISTS specials (
  id              SERIAL PRIMARY KEY,
  round_id        INT REFERENCES rounds(id)         ON DELETE CASCADE,
  round_player_id INT REFERENCES round_players(id)  ON DELETE CASCADE,
  round_game_id   INT REFERENCES round_games(id)    ON DELETE CASCADE,
  hole_number     INT NOT NULL,
  logged_at       TIMESTAMP DEFAULT NOW()
);

-- Setlist-style reactions per song per player (concert crew feature)
-- Reused here for hole-by-hole reactions ("what a shot!", "disaster", etc.)
CREATE TABLE IF NOT EXISTS hole_reactions (
  id              SERIAL PRIMARY KEY,
  round_id        INT REFERENCES rounds(id)         ON DELETE CASCADE,
  round_player_id INT REFERENCES round_players(id)  ON DELETE CASCADE,
  hole_number     INT  NOT NULL,
  reaction        VARCHAR(50) NOT NULL,  -- 'great' | 'disaster' | 'lucky' | 'clutch' | 'embarrassing'
  logged_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(round_id, round_player_id, hole_number, reaction)
);

-- Final settlements (computed + stored at end of round)
CREATE TABLE IF NOT EXISTS settlements (
  id          SERIAL PRIMARY KEY,
  round_id    INT REFERENCES rounds(id)        ON DELETE CASCADE,
  from_player INT REFERENCES round_players(id),
  to_player   INT REFERENCES round_players(id),
  amount      DECIMAL(6,2) NOT NULL,
  UNIQUE(round_id, from_player, to_player)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_round_players_round    ON round_players(round_id);
CREATE INDEX IF NOT EXISTS idx_round_players_user     ON round_players(user_id);
CREATE INDEX IF NOT EXISTS idx_hole_scores_round      ON hole_scores(round_id);
CREATE INDEX IF NOT EXISTS idx_specials_round         ON specials(round_id);
CREATE INDEX IF NOT EXISTS idx_specials_player        ON specials(round_player_id);
CREATE INDEX IF NOT EXISTS idx_settlements_round      ON settlements(round_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user       ON friendships(user_id);

-- Push notification subscriptions (added for PWA support)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT,
  auth        TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Add tee/course rating columns to rounds (for accurate handicap calculation)
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS slope_rating DECIMAL(5,1);
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS course_rating DECIMAL(5,2);
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS par_total INT DEFAULT 72;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS tee_name VARCHAR(50);
