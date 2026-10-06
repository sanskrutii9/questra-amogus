const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const { db, now, nameKey, currentRound, getSetting, setSetting } = require('./db');
const game = require('./game');
const { parseCsv, validateSetup, sampleSetupCsv } = require('./setupFile');

const PORT = Number(process.env.PORT || 3000);
const DEV_TOOLS = process.env.DEV_TOOLS === '1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Host password: HOST_PASSWORD env var, otherwise one generated once and kept in the database.
function hostPassword() {
  if (process.env.HOST_PASSWORD) return process.env.HOST_PASSWORD;
  let pw = getSetting('host_password');
  if (!pw) {
    pw = 'host-' + crypto.randomBytes(3).toString('hex');
    setSetting('host_password', pw);
  }
  return pw;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));
app.get('/host', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));
// Sample task file for any number of participants: /host/sample.csv?n=8
app.get('/host/sample.csv', (req, res) => {
  const n = Number(req.query.n) || 12;
  try {
    res.type('text/csv').attachment(`sample_game_setup_${n}.csv`).send(sampleSetupCsv(n));
  } catch (e) { res.status(400).send(e.message); }
});
app.use(express.static(PUBLIC_DIR));

const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

// ---------- presence (which logins have the page open) ----------

const sockets = new Map(); // login_id -> number of open connections
const onlineLogins = () => new Set([...sockets].filter(([, n]) => n > 0).map(([id]) => id));
const notifyHost = () => io.to('host').emit('host:update');

// ---------- participant auth (name only, no password: accepted risk) ----------

function loginFromToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT login_id FROM login_sessions WHERE token = ?').get(token);
  return row ? row.login_id : null;
}

function requireParticipant(req, res, next) {
  const loginId = loginFromToken(bearer(req));
  if (!loginId) return res.status(401).json({ error: 'Please log in again.' });
  req.loginId = loginId;
  next();
}

app.post('/api/login', (req, res) => {
  const name = String(req.body?.name || '');
  if (!name.trim()) return res.status(400).json({ error: 'Enter your name.' });
  const login = db.prepare('SELECT login_id FROM logins WHERE name_key = ?').get(nameKey(name));
  if (!login) return res.status(404).json({ error: 'Name not found. Check the spelling.' });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO login_sessions (token, login_id, created_at) VALUES (?, ?, ?)').run(token, login.login_id, now());
  res.json({ token, state: game.participantState(login.login_id) });
});

app.post('/api/logout', requireParticipant, (req, res) => {
  db.prepare('DELETE FROM login_sessions WHERE token = ?').run(bearer(req));
  res.json({ ok: true });
});

app.get('/api/me', requireParticipant, (req, res) => {
  res.json(game.participantState(req.loginId));
});

app.post('/api/tasks/:taskId/complete', requireParticipant, (req, res) => {
  const result = game.completeTask(req.loginId, req.params.taskId);
  if (!result.ok) return res.status(409).json({ error: result.error, state: game.participantState(req.loginId) });

  const state = game.participantState(req.loginId);
  io.to(`login:${req.loginId}`).emit('state', state); // keep this participant's devices in sync
  if (result.awarded) {
    io.to('host').emit('score:update', { roundId: result.roundId, scores: game.playerScores(result.roundId) });
    notifyHost();
  }
  res.json({ awarded: result.awarded, state });
});

// ---------- emergency meetings (participant side) ----------

const notifyMeeting = () => io.to('participants').emit('meeting:update');

app.post('/api/meeting', requireParticipant, (req, res) => {
  try {
    const { created } = game.callMeeting(req.loginId);
    if (created) { notifyMeeting(); notifyHost(); }
  } catch (e) {
    return res.status(409).json({ error: e.message, state: game.participantState(req.loginId) });
  }
  res.json(game.participantState(req.loginId));
});

app.post('/api/meeting/:id/ack', requireParticipant, (req, res) => {
  game.ackMeeting(Number(req.params.id), req.loginId);
  const state = game.participantState(req.loginId);
  io.to(`login:${req.loginId}`).emit('state', state); // close the pop-up on this person's other devices too
  notifyHost();
  res.json(state);
});

// ---------- host auth ----------

function hostFromToken(token) {
  return !!token && !!db.prepare('SELECT 1 FROM host_sessions WHERE token = ?').get(token);
}
function requireHost(req, res, next) {
  if (!hostFromToken(bearer(req))) return res.status(401).json({ error: 'Host login required.' });
  next();
}

const loginAttempts = new Map(); // ip -> [timestamps]
app.post('/api/host/login', (req, res) => {
  const ip = req.ip;
  const recent = (loginAttempts.get(ip) || []).filter((t) => Date.now() - t < 60_000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  recent.push(Date.now());
  loginAttempts.set(ip, recent);

  const given = Buffer.from(String(req.body?.password || ''));
  const real = Buffer.from(hostPassword());
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: 'Wrong host password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO host_sessions (token, created_at) VALUES (?, ?)').run(token, now());
  res.json({ token });
});

app.post('/api/host/logout', requireHost, (req, res) => {
  db.prepare('DELETE FROM host_sessions WHERE token = ?').run(bearer(req));
  res.json({ ok: true });
});

app.get('/api/host/state', requireHost, (req, res) => {
  res.json(game.hostState(onlineLogins()));
});

app.get('/api/host/scoring', requireHost, (req, res) => {
  res.json(game.scoringState(onlineLogins()));
});

// ---------- voting (host) ----------

const notifyAll = () => { broadcastRoundChange(); notifyHost(); };
const notifyDisplay = () => io.to('display').emit('display:update');

function hostAction(fn, after = notifyAll) {
  return (req, res) => {
    try {
      fn(req);
    } catch (e) {
      return res.status(e.tie ? 409 : 400).json({ error: e.message, tie: e.tie || null });
    }
    after();
    res.json(game.votingState());
  };
}

app.get('/api/host/voting', requireHost, (req, res) => res.json(game.votingState()));
app.post('/api/host/voting/start', requireHost, hostAction(() => game.startVoting()));
app.post('/api/host/voting/resume', requireHost, hostAction(() => game.resumeTasks()));
app.post('/api/host/votes/reset', requireHost, hostAction(() => game.resetVotes(), () => { notifyHost(); notifyDisplay(); }));
app.post('/api/host/votes/:playerId', requireHost,
  hostAction((req) => game.changeVote(req.params.playerId, Number(req.body?.delta) || 1), () => { notifyHost(); notifyDisplay(); }));
app.post('/api/host/voting/submit', requireHost, hostAction((req) => game.submitVotes(!!req.body?.allowTie)));
app.post('/api/host/display-settings', requireHost, hostAction((req) => {
  setSetting('display_show_counts', req.body?.showCounts ? '1' : '0');
}, notifyDisplay));

// ---------- host: meetings, end round, scorecards ----------

app.post('/api/host/meeting/:id/close', requireHost, (req, res) => {
  game.closeMeeting(Number(req.params.id));
  notifyMeeting();
  notifyHost();
  res.json(game.hostState(onlineLogins()));
});

app.post('/api/host/round/end', requireHost, (req, res) => {
  try { game.endRound(); } catch (e) { return res.status(400).json({ error: e.message }); }
  broadcastRoundChange();
  notifyHost();
  res.json(game.hostState(onlineLogins()));
});

app.get('/api/host/scorecards', requireHost, (req, res) => res.json(game.scorecards()));
app.get('/api/host/scorecards.csv', requireHost, (req, res) => {
  res.type('text/csv').attachment('questra_scorecards.csv').send(game.scorecardsCsv());
});

// ---------- public voting display (no login; nothing secret before the reveal) ----------

app.get('/display', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'display.html')));
app.get('/api/display/state', (req, res) => res.json(game.displayState()));

// Upload the task file (logins + names + 60 tasks + player links). Replaces everything.
app.post('/api/host/setup-file', requireHost, (req, res) => {
  let setup;
  try {
    setup = validateSetup(parseCsv(String(req.body?.csv || '')), Number(req.body?.count) || undefined);
  } catch (e) {
    return res.status(400).json({ error: 'The file has problems:', details: e.message.split('\n') });
  }
  if (game.hasRounds() && !req.body?.confirm) {
    return res.status(409).json({
      needsConfirm: true,
      error: 'Uploading a new task file erases all rounds, scores and scorecards, and logs every participant out.',
    });
  }
  game.loadSetup(setup);
  broadcastRoundChange();
  notifyHost();
  res.json(game.hostState(onlineLogins()));
});

app.post('/api/host/round/players', requireHost, (req, res) => {
  try {
    game.savePlayers(req.body?.players);
  } catch (e) {
    return res.status(400).json({ error: e.list ? 'Please fix these:' : e.message, details: e.list || [] });
  }
  broadcastRoundChange();
  notifyHost();
  res.json(game.hostState(onlineLogins()));
});

app.post('/api/host/round/start', requireHost, (req, res) => {
  try { game.startRound(); } catch (e) { return res.status(400).json({ error: e.message }); }
  broadcastRoundChange();
  notifyHost();
  res.json(game.hostState(onlineLogins()));
});

// ---------- realtime ----------

io.on('connection', (socket) => {
  const auth = socket.handshake.auth || {};
  if (auth.hostToken && hostFromToken(auth.hostToken)) {
    socket.join('host');
    return;
  }
  if (auth.display) {
    socket.join('display');
    return;
  }
  const loginId = loginFromToken(auth.token);
  if (!loginId) return;
  socket.join(`login:${loginId}`);
  socket.join('participants');
  sockets.set(loginId, (sockets.get(loginId) || 0) + 1);
  notifyHost();
  socket.on('disconnect', () => {
    sockets.set(loginId, Math.max(0, (sockets.get(loginId) || 1) - 1));
    notifyHost();
  });
});

// Tell every participant to re-fetch their own state (round started/ended/etc.).
function broadcastRoundChange() {
  const r = currentRound();
  io.to('participants').emit('round:changed', r ? { number: r.round_number, status: r.status } : null);
  io.to('display').emit('display:update');
}

// ---------- temporary dev tools (replaced by Host screens in later steps) ----------

if (DEV_TOOLS) {
  app.post('/api/dev/status', (req, res) => {
    try {
      const r = game.setRoundStatus(String(req.body?.status || '').toUpperCase());
      broadcastRoundChange();
      notifyHost();
      res.json(r);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/dev/next-round', (req, res) => {
    try {
      const prev = currentRound();
      if (prev && prev.status !== 'COMPLETED') game.endRound();
      game.createRound(game.roundPlayers(prev.round_id), 'ACTIVE');
      broadcastRoundChange();
      notifyHost();
      res.json(currentRound());
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  console.log('DEV_TOOLS enabled: POST /api/dev/status, /api/dev/next-round');
}

server.listen(PORT, () => {
  const r = currentRound();
  console.log('');
  console.log(`  Participants:  http://localhost:${PORT}`);
  console.log(`  Host:          http://localhost:${PORT}/host`);
  console.log(`  Host password: ${hostPassword()}${process.env.HOST_PASSWORD ? ' (from HOST_PASSWORD)' : ''}`);
  console.log(r ? `  Current round: ${r.round_number} (${r.status})` : '  No round yet. Set one up from the Host screen.');
  console.log('');
});

module.exports = { app, server, io, broadcastRoundChange };
