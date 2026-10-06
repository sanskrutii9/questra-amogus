// SQLite database: schema + small helpers.
// Fixed data (logins, task_templates) is loaded once from the setup file.
// Per-round data (rounds, round_players, task_progress, votes) is created every round.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'game.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- FIXED: L1–L12 and the name each participant logs in with
CREATE TABLE IF NOT EXISTS logins (
  login_id   TEXT PRIMARY KEY,             -- L1..L12 (internal)
  login_name TEXT NOT NULL,                -- shown to the participant
  name_key   TEXT NOT NULL UNIQUE          -- lower(trim(name)) for matching
);

-- FIXED: 60 tasks, which login sees them, which player gets the point
CREATE TABLE IF NOT EXISTS task_templates (
  task_id   TEXT PRIMARY KEY,
  login_id  TEXT NOT NULL REFERENCES logins(login_id),
  player_id TEXT NOT NULL,                 -- P1..P12
  task_name TEXT NOT NULL,
  position  INTEGER NOT NULL               -- order within the login's list
);

CREATE TABLE IF NOT EXISTS rounds (
  round_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_number     INTEGER NOT NULL UNIQUE,  -- 1..10
  status           TEXT NOT NULL,            -- SETUP/ACTIVE/VOTING/REVEALED/COMPLETED
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  ended_at         TEXT,
  result_player_id TEXT
);

-- PER ROUND: real names + secret roles behind P1..P12
CREATE TABLE IF NOT EXISTS round_players (
  round_id  INTEGER NOT NULL REFERENCES rounds(round_id),
  player_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('innocent','impostor')),
  PRIMARY KEY (round_id, player_id)
);

-- PER ROUND: completion of each task
CREATE TABLE IF NOT EXISTS task_progress (
  round_id     INTEGER NOT NULL REFERENCES rounds(round_id),
  task_id      TEXT NOT NULL REFERENCES task_templates(task_id),
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by TEXT,
  PRIMARY KEY (round_id, task_id)
);

-- PER ROUND: votes
CREATE TABLE IF NOT EXISTS votes (
  round_id   INTEGER NOT NULL REFERENCES rounds(round_id),
  player_id  TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, player_id)
);

-- Participant sessions (no password: name -> random token kept by the browser)
CREATE TABLE IF NOT EXISTS login_sessions (
  token      TEXT PRIMARY KEY,
  login_id   TEXT NOT NULL REFERENCES logins(login_id),
  created_at TEXT NOT NULL
);

-- PER ROUND, FROZEN: written once when the Host ends the round (doc Section 25.5)
CREATE TABLE IF NOT EXISTS scorecards (
  round_id        INTEGER NOT NULL REFERENCES rounds(round_id),
  round_number    INTEGER NOT NULL,
  player_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  tasks_completed INTEGER NOT NULL,
  score           INTEGER NOT NULL,
  votes           INTEGER NOT NULL,
  was_voted_out   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, player_id)
);

-- Emergency meetings (doc Section 26)
CREATE TABLE IF NOT EXISTS meetings (
  meeting_id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES rounds(round_id),
  called_by  TEXT NOT NULL,                -- login_id
  called_at  TEXT NOT NULL,
  status     TEXT NOT NULL,                -- OPEN / CLOSED
  closed_at  TEXT
);
-- Only one OPEN meeting per round, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_meeting ON meetings(round_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS meeting_acks (
  meeting_id INTEGER NOT NULL REFERENCES meetings(meeting_id),
  acked_by   TEXT NOT NULL,                -- login_id, or HOST
  acked_at   TEXT NOT NULL,
  PRIMARY KEY (meeting_id, acked_by)
);

-- Host sessions (password login)
CREATE TABLE IF NOT EXISTS host_sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`);

// Migrations for databases created by earlier steps.
const roundCols = db.prepare('PRAGMA table_info(rounds)').all().map((c) => c.name);
if (!roundCols.includes('result_type')) db.exec('ALTER TABLE rounds ADD COLUMN result_type TEXT');      // player / tie
if (!roundCols.includes('result_votes')) db.exec('ALTER TABLE rounds ADD COLUMN result_votes INTEGER');
if (!roundCols.includes('result_tied')) db.exec('ALTER TABLE rounds ADD COLUMN result_tied TEXT');      // JSON list of player_ids

const now = () => new Date().toISOString();
const nameKey = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// The round shown to everyone: the latest one created (or null before Round 1).
function currentRound() {
  return db.prepare('SELECT * FROM rounds ORDER BY round_number DESC LIMIT 1').get() || null;
}

module.exports = { db, now, nameKey, getSetting, setSetting, currentRound };
