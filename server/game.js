// Game logic shared by the participant and (later) host interfaces.

const { db, now, currentRound, getSetting, setSetting } = require('./db');

const TOTAL_ROUNDS = () => Number(getSetting('total_rounds', 10));

// Replace the fixed layout (logins + 60 tasks). Wipes all rounds.
const loadSetup = db.transaction(({ count, logins, tasks }) => {
  setSetting('participant_count', count || logins.length);
  db.exec(`DELETE FROM login_sessions; DELETE FROM meeting_acks; DELETE FROM meetings; DELETE FROM scorecards;
           DELETE FROM votes; DELETE FROM task_progress;
           DELETE FROM round_players; DELETE FROM rounds; DELETE FROM task_templates; DELETE FROM logins;
           DELETE FROM sqlite_sequence WHERE name IN ('rounds', 'meetings');`);
  const insLogin = db.prepare('INSERT INTO logins (login_id, login_name, name_key) VALUES (?, ?, ?)');
  const insTask = db.prepare('INSERT INTO task_templates (task_id, login_id, player_id, task_name, position) VALUES (?, ?, ?, ?, ?)');
  logins.forEach((l) => insLogin.run(l.login_id, l.login_name, l.name_key));
  tasks.forEach((t) => insTask.run(t.task_id, t.login_id, t.player_id, t.task_name, t.position));
});

// Create the next round with fresh (unchecked) progress and zero votes.
const createRound = db.transaction((players, status = 'SETUP') => {
  const last = currentRound();
  const number = last ? last.round_number + 1 : 1;
  if (number > TOTAL_ROUNDS()) throw new Error('All rounds have been played.');
  const ts = now();
  const { lastInsertRowid: roundId } = db
    .prepare('INSERT INTO rounds (round_number, status, created_at, started_at) VALUES (?, ?, ?, ?)')
    .run(number, status, ts, status === 'ACTIVE' ? ts : null);
  const insP = db.prepare('INSERT INTO round_players (round_id, player_id, name, role) VALUES (?, ?, ?, ?)');
  const insV = db.prepare('INSERT INTO votes (round_id, player_id, vote_count) VALUES (?, ?, 0)');
  players.forEach((p) => { insP.run(roundId, p.player_id, p.name, p.role); insV.run(roundId, p.player_id); });
  db.prepare(`INSERT INTO task_progress (round_id, task_id, completed)
              SELECT ?, task_id, 0 FROM task_templates`).run(roundId);
  return roundId;
});

function setRoundStatus(status) {
  const round = currentRound();
  if (!round) throw new Error('No round exists yet.');
  const ts = now();
  db.prepare(`UPDATE rounds SET status = ?,
                started_at = CASE WHEN ? = 'ACTIVE' AND started_at IS NULL THEN ? ELSE started_at END,
                ended_at   = CASE WHEN ? = 'COMPLETED' THEN ? ELSE ended_at END
              WHERE round_id = ?`).run(status, status, ts, status, ts, round.round_id);
  return currentRound();
}

// What a participant is allowed to see. Never includes player IDs, names or roles.
function participantState(loginId) {
  const login = db.prepare('SELECT login_name FROM logins WHERE login_id = ?').get(loginId);
  const round = currentRound();
  const base = {
    name: login.login_name,
    totalRounds: TOTAL_ROUNDS(),
    round: round ? { number: round.round_number, status: round.status } : null,
    tasks: [],
  };
  if (!round || round.status === 'SETUP' || round.status === 'COMPLETED') return base;

  // Emergency meeting: the open one (if any) and whether this login has said OK.
  const m = openMeeting(round.round_id);
  base.meeting = m ? {
    id: m.meeting_id,
    calledBy: m.caller_name,
    calledAt: m.called_at,
    mine: m.called_by === loginId,
    acked: !!db.prepare('SELECT 1 FROM meeting_acks WHERE meeting_id = ? AND acked_by = ?').get(m.meeting_id, loginId),
  } : null;
  base.canCallMeeting = round.status === 'ACTIVE' && !m;

  base.tasks = db.prepare(`
      SELECT t.task_id AS id, t.task_name AS name, p.completed AS done, p.completed_at AS doneAt
      FROM task_templates t
      JOIN task_progress p ON p.task_id = t.task_id AND p.round_id = ?
      WHERE t.login_id = ?
      ORDER BY t.position`).all(round.round_id, loginId)
    .map((t) => ({ ...t, done: !!t.done }));
  return base;
}

// Backend-enforced completion (doc Sections 8 and 25.7).
// Returns { ok, awarded, playerId? , error? }.
const completeTask = db.transaction((loginId, taskId) => {
  const round = currentRound();
  if (!round || round.status !== 'ACTIVE') return { ok: false, error: 'Tasks are locked right now.' };
  const task = db.prepare('SELECT * FROM task_templates WHERE task_id = ?').get(taskId);
  if (!task || task.login_id !== loginId) return { ok: false, error: 'That task is not on your list.' };
  const res = db.prepare(`UPDATE task_progress SET completed = 1, completed_at = ?, completed_by = ?
                          WHERE round_id = ? AND task_id = ? AND completed = 0`)
    .run(now(), loginId, round.round_id, taskId);
  // changes === 0 means it was already completed: no second point.
  return { ok: true, awarded: res.changes === 1, playerId: task.player_id, roundId: round.round_id };
});

// Live score for every player in the current round (used by host screens later).
function playerScores(roundId) {
  return db.prepare(`
      SELECT rp.player_id, rp.name,
             COALESCE(SUM(tp.completed), 0) AS score
      FROM round_players rp
      LEFT JOIN task_templates t ON t.player_id = rp.player_id
      LEFT JOIN task_progress tp ON tp.task_id = t.task_id AND tp.round_id = rp.round_id
      WHERE rp.round_id = ?
      GROUP BY rp.player_id
      ORDER BY CAST(SUBSTR(rp.player_id, 2) AS INTEGER)`).all(roundId);
}

// ---------- Host: round setup ----------

// Number of participants (= logins = players) from the loaded task file.
const participantCount = () => Number(getSetting('participant_count', 0)) || db.prepare('SELECT COUNT(*) AS n FROM logins').get().n;
const playerIdList = () => Array.from({ length: participantCount() }, (_, i) => `P${i + 1}`);

function validatePlayers(input) {
  const errors = [];
  if (!Array.isArray(input)) throw new Error('Players list is missing.');
  const byId = new Map(input.map((p) => [String(p.player_id || '').toUpperCase(), p]));
  const seen = new Map();
  const players = playerIdList().map((id) => {
    const p = byId.get(id) || {};
    const name = String(p.name || '').trim().replace(/\s+/g, ' ');
    const role = String(p.role || '').toLowerCase();
    if (!name) errors.push(`${id}: enter a name.`);
    else {
      const key = name.toLowerCase();
      if (seen.has(key)) errors.push(`${id}: "${name}" is already used by ${seen.get(key)}.`);
      seen.set(key, id);
    }
    if (role !== 'innocent' && role !== 'impostor') errors.push(`${id}: choose Innocent or Impostor.`);
    return { player_id: id, name, role };
  });
  if (errors.length) { const e = new Error(errors.join('\n')); e.list = errors; throw e; }
  return players;
}

const roundPlayers = (roundId) => db.prepare(`
  SELECT player_id, name, role FROM round_players WHERE round_id = ?
  ORDER BY CAST(SUBSTR(player_id, 2) AS INTEGER)`).all(roundId);

// Save names + roles: edits the round in SETUP, or creates the next round in SETUP.
const savePlayers = db.transaction((input) => {
  const players = validatePlayers(input);
  if (!db.prepare('SELECT COUNT(*) AS n FROM task_templates').get().n) throw new Error('Upload the task file first.');
  const round = currentRound();
  if (round && round.status === 'SETUP') {
    const upd = db.prepare('UPDATE round_players SET name = ?, role = ? WHERE round_id = ? AND player_id = ?');
    players.forEach((p) => upd.run(p.name, p.role, round.round_id, p.player_id));
    return currentRound();
  }
  if (round && round.status !== 'COMPLETED') throw new Error(`Round ${round.round_number} is still running.`);
  createRound(players, 'SETUP');
  return currentRound();
});

function startRound() {
  const round = currentRound();
  if (!round || round.status !== 'SETUP') throw new Error('Save the player names for this round first.');
  return setRoundStatus('ACTIVE');
}

// Everything the Host setup screen needs.
function hostState(onlineLogins = new Set()) {
  const round = currentRound();
  const tasks = db.prepare('SELECT * FROM task_templates ORDER BY login_id, position').all();
  const logins = db.prepare(`SELECT login_id, login_name FROM logins
                             ORDER BY CAST(SUBSTR(login_id, 2) AS INTEGER)`).all()
    .map((l) => ({
      ...l,
      online: onlineLogins.has(l.login_id),
      tasks: tasks.filter((t) => t.login_id === l.login_id)
        .map((t) => ({ task_id: t.task_id, task_name: t.task_name, player_id: t.player_id })),
    }));

  const total = TOTAL_ROUNDS();
  let form;
  if (round && round.status !== 'COMPLETED') {
    form = { roundNumber: round.round_number, editable: round.status === 'SETUP', players: roundPlayers(round.round_id) };
  } else {
    const next = round ? round.round_number + 1 : 1;
    form = { roundNumber: next, editable: next <= total, players: [] };
  }
  const prev = db.prepare(`SELECT round_id, round_number FROM rounds WHERE status = 'COMPLETED'
                           ORDER BY round_number DESC LIMIT 1`).get();

  return {
    totalRounds: total,
    setup: { loaded: logins.length > 0, count: logins.length, taskCount: tasks.length, logins },
    onlineCount: logins.filter((l) => l.online).length,
    round: round ? { number: round.round_number, status: round.status, startedAt: round.started_at } : null,
    form,
    previousRound: prev ? { number: prev.round_number, players: roundPlayers(prev.round_id) } : null,
    meeting: hostMeeting(),
  };
}

const hasRounds = () => !!currentRound();

// ---------- Host: live scoring (doc Section 10) ----------
// Roles are deliberately NOT included here.
function scoringState(onlineLogins = new Set()) {
  const round = currentRound();
  if (!round || round.status === 'SETUP') {
    return { round: round ? { number: round.round_number, status: round.status } : null, ready: false };
  }
  const rows = db.prepare(`
      SELECT t.task_id, t.task_name, t.position, t.login_id, l.login_name,
             t.player_id, rp.name AS player_name,
             tp.completed AS done, tp.completed_at AS done_at
      FROM task_templates t
      JOIN logins l ON l.login_id = t.login_id
      JOIN task_progress tp ON tp.task_id = t.task_id AND tp.round_id = ?
      LEFT JOIN round_players rp ON rp.player_id = t.player_id AND rp.round_id = tp.round_id
      ORDER BY CAST(SUBSTR(t.login_id, 2) AS INTEGER), t.position`).all(round.round_id)
    .map((r) => ({ ...r, done: !!r.done }));

  const num = (id) => Number(id.slice(1));
  const latest = (list) => list.filter((t) => t.done).map((t) => t.done_at).sort().pop() || null;

  const players = roundPlayers(round.round_id).map((p) => {
    const tasks = rows.filter((r) => r.player_id === p.player_id)
      .map((r) => ({ task_id: r.task_id, task_name: r.task_name, login_id: r.login_id, login_name: r.login_name, done: r.done, done_at: r.done_at }));
    return { player_id: p.player_id, name: p.name, score: tasks.filter((t) => t.done).length, total: tasks.length, last_at: latest(tasks), tasks };
  });

  const logins = db.prepare('SELECT login_id, login_name FROM logins').all()
    .sort((a, b) => num(a.login_id) - num(b.login_id))
    .map((l) => {
      const tasks = rows.filter((r) => r.login_id === l.login_id)
        .map((r) => ({ task_id: r.task_id, task_name: r.task_name, player_id: r.player_id, player_name: r.player_name, done: r.done, done_at: r.done_at }));
      return { ...l, online: onlineLogins.has(l.login_id), done: tasks.filter((t) => t.done).length, total: tasks.length, last_at: latest(tasks), tasks };
    });

  const feed = rows.filter((r) => r.done)
    .sort((a, b) => (a.done_at < b.done_at ? 1 : -1))
    .slice(0, 30)
    .map((r) => ({ at: r.done_at, login_id: r.login_id, login_name: r.login_name, task_name: r.task_name, player_id: r.player_id, player_name: r.player_name }));

  const done = rows.filter((r) => r.done).length;
  return {
    ready: true,
    round: { number: round.round_number, status: round.status, startedAt: round.started_at, endedAt: round.ended_at },
    totals: { done, total: rows.length, online: logins.filter((l) => l.online).length },
    players,
    logins,
    feed,
    meetings: meetingLog(round.round_id),
  };
}

// ---------- Voting (doc Sections 14–16) ----------

function requireStatus(...allowed) {
  const round = currentRound();
  if (!round || !allowed.includes(round.status)) {
    const msg = {
      VOTING: 'Voting is not open right now.',
      ACTIVE: 'The round is not running right now.',
    }[allowed[0]] || 'Not allowed right now.';
    throw new Error(msg);
  }
  return round;
}

const startVoting = () => { requireStatus('ACTIVE'); return setRoundStatus('VOTING'); };
const resumeTasks = () => { requireStatus('VOTING'); return setRoundStatus('ACTIVE'); };

const changeVote = db.transaction((playerId, delta) => {
  const round = requireStatus('VOTING');
  const d = delta < 0 ? -1 : 1;
  const res = db.prepare('UPDATE votes SET vote_count = MAX(0, vote_count + ?) WHERE round_id = ? AND player_id = ?')
    .run(d, round.round_id, String(playerId).toUpperCase());
  if (!res.changes) throw new Error('Unknown player.');
});

function resetVotes() {
  const round = requireStatus('VOTING');
  db.prepare('UPDATE votes SET vote_count = 0 WHERE round_id = ?').run(round.round_id);
}

const voteRows = (roundId) => db.prepare(`
  SELECT v.player_id, rp.name, rp.role, v.vote_count AS votes
  FROM votes v JOIN round_players rp ON rp.round_id = v.round_id AND rp.player_id = v.player_id
  WHERE v.round_id = ? ORDER BY CAST(SUBSTR(v.player_id, 2) AS INTEGER)`).all(roundId);

// Highest vote wins. A tie needs allowTie=true and reveals nobody.
const submitVotes = db.transaction((allowTie = false) => {
  const round = requireStatus('VOTING');
  const rows = voteRows(round.round_id);
  const max = Math.max(...rows.map((r) => r.votes));
  if (max <= 0) { const e = new Error('No votes yet. Add votes before submitting.'); throw e; }
  const top = rows.filter((r) => r.votes === max);
  if (top.length > 1 && !allowTie) {
    const e = new Error(`It's a tie: ${top.map((t) => t.name).join(' and ')} have ${max} votes each.`);
    e.tie = { names: top.map((t) => t.name), votes: max };
    throw e;
  }
  const isTie = top.length > 1;
  db.prepare(`UPDATE rounds SET status = 'REVEALED', result_type = ?, result_player_id = ?, result_votes = ?, result_tied = ?
              WHERE round_id = ?`)
    .run(isTie ? 'tie' : 'player', isTie ? null : top[0].player_id, max,
      isTie ? JSON.stringify(top.map((t) => t.player_id)) : null, round.round_id);
  return currentRound();
});

function roundResult(round, rows) {
  if (!round || !round.result_type) return null;
  if (round.result_type === 'tie') {
    const ids = JSON.parse(round.result_tied || '[]');
    return { type: 'tie', votes: round.result_votes, tied: rows.filter((r) => ids.includes(r.player_id)).map((r) => r.name) };
  }
  const p = rows.find((r) => r.player_id === round.result_player_id);
  return { type: 'player', player_id: p.player_id, name: p.name, role: p.role, votes: round.result_votes };
}

// Host voting tab. Roles are only included inside `result` (after the reveal).
function votingState() {
  const round = currentRound();
  if (!round || round.status === 'SETUP') return { round: round ? { number: round.round_number, status: round.status } : null, ready: false };
  const rows = voteRows(round.round_id);
  return {
    ready: true,
    round: { number: round.round_number, status: round.status },
    players: rows.map(({ player_id, name, votes }) => ({ player_id, name, votes })),
    total: rows.reduce((s, r) => s + r.votes, 0),
    showCounts: getSetting('display_show_counts', '0') === '1',
    result: roundResult(round, rows),
  };
}

// Public display. Never includes player IDs; roles only after the reveal.
function displayState() {
  const round = currentRound();
  const base = { round: round ? { number: round.round_number, status: round.status } : null, totalRounds: TOTAL_ROUNDS() };
  if (!round || !['VOTING', 'REVEALED'].includes(round.status)) return base;
  const rows = voteRows(round.round_id);
  const showCounts = getSetting('display_show_counts', '0') === '1';
  base.names = rows.map((r) => ({ name: r.name, votes: showCounts || round.status === 'REVEALED' ? r.votes : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  base.total = showCounts ? rows.reduce((s, r) => s + r.votes, 0) : null;
  if (round.status === 'REVEALED') {
    const res = roundResult(round, rows);
    base.result = res.type === 'tie' ? res : { type: 'player', name: res.name, role: res.role, votes: res.votes };
  }
  return base;
}

// ---------- Emergency meetings (doc Section 26) ----------

function openMeeting(roundId) {
  return db.prepare(`SELECT m.*, l.login_name AS caller_name FROM meetings m JOIN logins l ON l.login_id = m.called_by
                     WHERE m.round_id = ? AND m.status = 'OPEN'`).get(roundId) || null;
}

// Returns { meeting, created }. A second caller at the same moment just gets the existing meeting.
const callMeeting = db.transaction((loginId) => {
  const round = currentRound();
  if (!round || round.status !== 'ACTIVE') throw new Error('Meetings can only be called while the round is running.');
  const existing = openMeeting(round.round_id);
  if (existing) return { meeting: existing, created: false };
  const ts = now();
  const { lastInsertRowid: id } = db.prepare(`INSERT INTO meetings (round_id, called_by, called_at, status) VALUES (?, ?, ?, 'OPEN')`)
    .run(round.round_id, loginId, ts);
  // The caller has obviously seen it.
  db.prepare('INSERT INTO meeting_acks (meeting_id, acked_by, acked_at) VALUES (?, ?, ?)').run(id, loginId, ts);
  return { meeting: openMeeting(round.round_id), created: true };
});

function ackMeeting(meetingId, who) {
  db.prepare('INSERT OR IGNORE INTO meeting_acks (meeting_id, acked_by, acked_at) VALUES (?, ?, ?)').run(meetingId, who, now());
}

// Host OK closes the meeting and re-enables everyone's button.
const closeMeeting = db.transaction((meetingId) => {
  const m = db.prepare(`SELECT * FROM meetings WHERE meeting_id = ? AND status = 'OPEN'`).get(meetingId);
  if (!m) return false;
  ackMeeting(meetingId, 'HOST');
  db.prepare(`UPDATE meetings SET status = 'CLOSED', closed_at = ? WHERE meeting_id = ?`).run(now(), meetingId);
  return true;
});

// For the host pop-up: who called it and who has (not) pressed OK.
function hostMeeting() {
  const round = currentRound();
  if (!round) return null;
  const m = openMeeting(round.round_id);
  if (!m) return null;
  const acked = new Set(db.prepare('SELECT acked_by FROM meeting_acks WHERE meeting_id = ?').all(m.meeting_id).map((r) => r.acked_by));
  const others = db.prepare('SELECT login_id, login_name FROM logins').all()
    .filter((l) => l.login_id !== m.called_by)
    .sort((a, b) => Number(a.login_id.slice(1)) - Number(b.login_id.slice(1)));
  return {
    id: m.meeting_id,
    calledBy: { login_id: m.called_by, login_name: m.caller_name },
    calledAt: m.called_at,
    ackedCount: others.filter((l) => acked.has(l.login_id)).length,
    otherCount: others.length,
    waiting: others.filter((l) => !acked.has(l.login_id)),
  };
}

function meetingLog(roundId) {
  return db.prepare(`SELECT m.meeting_id AS id, m.called_by AS login_id, l.login_name, m.called_at, m.status, m.closed_at
                     FROM meetings m JOIN logins l ON l.login_id = m.called_by
                     WHERE m.round_id = ? ORDER BY m.called_at`).all(roundId);
}

// ---------- End round + scorecards (doc Sections 25.3 and 25.5) ----------

const endRound = db.transaction(() => {
  const round = currentRound();
  if (!round || !['ACTIVE', 'VOTING', 'REVEALED'].includes(round.status)) throw new Error('There is no running round to end.');
  // Close any open meeting.
  const m = openMeeting(round.round_id);
  if (m) closeMeeting(m.meeting_id);
  // Freeze the scorecard.
  const scores = new Map(playerScores(round.round_id).map((p) => [p.player_id, p.score]));
  const votes = new Map(db.prepare('SELECT player_id, vote_count FROM votes WHERE round_id = ?').all(round.round_id).map((v) => [v.player_id, v.vote_count]));
  const ins = db.prepare(`INSERT INTO scorecards (round_id, round_number, player_id, name, role, tasks_completed, score, votes, was_voted_out)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  roundPlayers(round.round_id).forEach((p) => {
    const s = scores.get(p.player_id) || 0;
    ins.run(round.round_id, round.round_number, p.player_id, p.name, p.role, s, s, votes.get(p.player_id) || 0,
      round.result_type === 'player' && round.result_player_id === p.player_id ? 1 : 0);
  });
  return setRoundStatus('COMPLETED');
});

function scorecards() {
  const rounds = db.prepare(`SELECT * FROM rounds WHERE status = 'COMPLETED' ORDER BY round_number`).all();
  return rounds.map((r) => {
    const players = db.prepare(`SELECT player_id, name, role, tasks_completed, score, votes, was_voted_out
                                FROM scorecards WHERE round_id = ? ORDER BY CAST(SUBSTR(player_id, 2) AS INTEGER)`).all(r.round_id)
      .map((p) => ({ ...p, was_voted_out: !!p.was_voted_out }));
    let result = { type: 'none' };
    if (r.result_type === 'player') {
      const p = players.find((x) => x.player_id === r.result_player_id);
      result = { type: 'player', name: p?.name, role: p?.role, votes: r.result_votes };
    } else if (r.result_type === 'tie') {
      const ids = JSON.parse(r.result_tied || '[]');
      result = { type: 'tie', votes: r.result_votes, tied: players.filter((p) => ids.includes(p.player_id)).map((p) => p.name) };
    }
    return {
      round_number: r.round_number,
      started_at: r.started_at,
      ended_at: r.ended_at,
      result,
      players,
      meetings: meetingLog(r.round_id).map(({ login_id, login_name, called_at }) => ({ login_id, login_name, called_at })),
    };
  });
}

function scorecardsCsv() {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = ['round,player_id,name,role,tasks_completed,score,votes,voted_out,round_result,meetings_called'];
  scorecards().forEach((sc) => {
    const res = sc.result.type === 'player' ? `${sc.result.name} (${sc.result.role})` : sc.result.type === 'tie' ? 'tie' : 'no vote';
    sc.players.forEach((p) => lines.push([sc.round_number, p.player_id, p.name, p.role, p.tasks_completed, p.score, p.votes,
      p.was_voted_out ? 'yes' : 'no', res, sc.meetings.length].map(q).join(',')));
  });
  return lines.join('\n') + '\n';
}

module.exports = {
  participantCount,
  callMeeting, ackMeeting, closeMeeting, hostMeeting, meetingLog, openMeeting, endRound, scorecards, scorecardsCsv,
  startVoting, resumeTasks, changeVote, resetVotes, submitVotes, votingState, displayState,
  loadSetup, createRound, setRoundStatus, participantState, completeTask, playerScores, TOTAL_ROUNDS,
  validatePlayers, savePlayers, startRound, hostState, hasRounds, roundPlayers, scoringState,
};
