// Parse + validate the task upload file (architecture doc, Section 5.1).
// Columns: login_id, login_name, task_id, task_name, player_id

const { nameKey } = require('./db');

// Small CSV parser (handles quoted fields with commas / "" escapes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 20;
const TASKS_PER_LOGIN = 5;
const loginIds = (n) => Array.from({ length: n }, (_, i) => `L${i + 1}`);
const playerIds = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

// Returns { count, logins, tasks } or throws an Error listing every problem found.
// `expected` = number of participants the Host chose (N). The file must contain exactly
// N logins (L1–LN) × 5 tasks, linked to P1–PN, with every player linked to exactly 5 tasks.
function validateSetup(rows, expected) {
  const errors = [];
  const required = ['login_id', 'login_name', 'task_id', 'task_name', 'player_id'];
  if (!rows.length) throw new Error('The file has no rows.');
  const missing = required.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`);

  // If the Host didn't choose, use the number of logins in the file.
  const inFile = new Set(rows.map((r) => r.login_id.trim().toUpperCase())).size;
  const n = Number(expected) || inFile;
  if (!Number.isInteger(n) || n < MIN_PARTICIPANTS || n > MAX_PARTICIPANTS) {
    throw new Error(`Number of participants must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}.`);
  }
  const LOGIN_IDS = loginIds(n);
  const PLAYER_IDS = playerIds(n);
  if (inFile !== n) errors.push(`You chose ${n} participants, but the file has ${inFile} different login IDs.`);
  if (rows.length !== n * TASKS_PER_LOGIN) errors.push(`Expected ${n * TASKS_PER_LOGIN} task rows (${n} × ${TASKS_PER_LOGIN}), found ${rows.length}.`);

  const byLogin = new Map();
  const perPlayer = new Map(PLAYER_IDS.map((p) => [p, 0]));
  const taskIds = new Set();
  rows.forEach((r, i) => {
    const line = i + 2; // +1 header, +1 for 1-based lines
    const loginId = r.login_id.toUpperCase();
    const playerId = r.player_id.toUpperCase();
    if (!LOGIN_IDS.includes(loginId)) errors.push(`Line ${line}: login_id "${r.login_id}" must be L1–L${n}.`);
    if (!PLAYER_IDS.includes(playerId)) errors.push(`Line ${line}: player_id "${r.player_id}" must be P1–P${n}.`);
    else perPlayer.set(playerId, perPlayer.get(playerId) + 1);
    if (!r.login_name) errors.push(`Line ${line}: login_name is empty.`);
    if (!r.task_name) errors.push(`Line ${line}: task_name is empty.`);
    if (!r.task_id) errors.push(`Line ${line}: task_id is empty.`);
    else if (taskIds.has(r.task_id)) errors.push(`Line ${line}: task_id "${r.task_id}" is used twice.`);
    taskIds.add(r.task_id);
    if (!byLogin.has(loginId)) byLogin.set(loginId, []);
    byLogin.get(loginId).push({ ...r, login_id: loginId, player_id: playerId });
  });

  const logins = [];
  const seenNames = new Map();
  for (const id of LOGIN_IDS) {
    const list = byLogin.get(id) || [];
    if (list.length !== TASKS_PER_LOGIN) errors.push(`${id} has ${list.length} tasks (needs exactly ${TASKS_PER_LOGIN}).`);
    if (!list.length) continue;
    const names = new Set(list.map((t) => t.login_name));
    if (names.size > 1) errors.push(`${id} has different login names: ${[...names].join(' / ')}.`);
    const name = list[0].login_name;
    const key = nameKey(name);
    if (seenNames.has(key)) errors.push(`Login name "${name}" is used by both ${seenNames.get(key)} and ${id}.`);
    seenNames.set(key, id);
    logins.push({ login_id: id, login_name: name.trim().replace(/\s+/g, ' '), name_key: key });
  }
  for (const [p, c] of perPlayer) {
    if (c !== TASKS_PER_LOGIN) errors.push(`${p} is linked to ${c} task${c === 1 ? '' : 's'} (needs exactly ${TASKS_PER_LOGIN}).`);
  }

  if (errors.length) throw new Error(errors.join('\n'));

  const tasks = [];
  for (const id of LOGIN_IDS) {
    byLogin.get(id).forEach((t, idx) =>
      tasks.push({ task_id: t.task_id, login_id: id, player_id: t.player_id, task_name: t.task_name, position: idx + 1 }));
  }
  return { count: n, logins, tasks };
}

// ---------- sample files for any N (used by "Download sample" and the dummy datasets) ----------

const SAMPLE_LOGIN_NAMES = ['415', '416', '417', '418', '419', '402', 'loby', 'square', 'stairs', '407', '414', 'loby2',
  '420', '421', '403', 'canteen', 'library', 'lab1', 'lab2', 'gate'];
const SAMPLE_TASKS = ['Find the hidden clue', 'Fix the wiring panel', 'Scan your ID card', 'Empty the trash bin', 'Align the engine output',
  'Download the data file', 'Upload the data file', 'Solve the notice-board riddle', 'Fuel the generator', 'Calibrate the distributor',
  'Clear the asteroid sketch', 'Inspect the sample', 'Swipe the access card', 'Divert the power', 'Stabilise the steering',
  'Reboot the Wi-Fi', 'Unlock the manifold', 'Prime the shields', 'Chart the course', 'Clean the O2 filter',
  'Start the reactor', 'Record the temperature', 'Sort the samples', 'Restore the lights', 'Fix the comms',
  'Match the colour cards', 'Count the chairs in Room B', 'Collect a blue sticker', 'Get a signature from the host', 'Stack the cups',
  'Find the QR code', 'Solve the number lock', 'Deliver the envelope', 'Water the plant', 'Sort the coloured pens',
  'Copy the secret code', 'Find the red marker', 'Arrange the books', 'Decode the cipher', 'Fold a paper plane',
  'Spot the odd photo', 'Tie the knot', 'Ring the bell twice', 'Find the lost key', 'Match the socks',
  'Solve the jigsaw', 'Write a password backwards', 'Find the hidden emoji', 'Balance the scale', 'Light the lamp',
  'Read the wall clock', 'Count the posters', 'Trace the maze', 'Press the hidden switch', 'Pin the map marker',
  'Find the green card', 'Repair the chain', 'Fill the water bottle', 'Match the logos', 'Close the vent'];

// Each login's 5 tasks point to 5 different players, and every player gets exactly 5 tasks.
function sampleSetupCsv(n) {
  if (!Number.isInteger(n) || n < MIN_PARTICIPANTS || n > MAX_PARTICIPANTS) throw new Error('Bad participant count.');
  const lines = ['login_id,login_name,task_id,task_name,player_id'];
  let t = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < TASKS_PER_LOGIN; k++) {
      const player = ((i + k + 1) % n) + 1;
      const name = SAMPLE_TASKS[t % SAMPLE_TASKS.length] + (t >= SAMPLE_TASKS.length ? ` ${Math.floor(t / SAMPLE_TASKS.length) + 1}` : '');
      lines.push(`L${i + 1},${SAMPLE_LOGIN_NAMES[i]},T${String(t + 1).padStart(2, '0')},${name},P${player}`);
      t++;
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { parseCsv, validateSetup, sampleSetupCsv, loginIds, playerIds, MIN_PARTICIPANTS, MAX_PARTICIPANTS, TASKS_PER_LOGIN };
