// Reset the game and load a dummy task file.
//
//   npm run seed        -> 12 participants (data/game_setup.csv), no round yet
//   npm run seed:6      -> 6 participants  (data/game_setup_6.csv)
//   npm run seed:8      -> 8 participants  (data/game_setup_8.csv)
//   add --demo          -> also creates Round 1 with dummy names and starts it (skips host setup)
//                          e.g.  npm run seed:8 -- --demo

const fs = require('fs');
const path = require('path');
const { setSetting } = require('./db');
const { parseCsv, validateSetup } = require('./setupFile');
const { loadSetup, createRound } = require('./game');

const dataDir = path.join(__dirname, '..', 'data');
const demo = process.argv.includes('--demo');
const n = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=12').split('=')[1]);
const suffix = n === 12 ? '' : `_${n}`;
const setupPath = path.join(dataDir, `game_setup${suffix}.csv`);
if (!fs.existsSync(setupPath)) {
  console.error(`No dummy file for ${n} participants (${path.basename(setupPath)}).`);
  process.exit(1);
}

const setup = validateSetup(parseCsv(fs.readFileSync(setupPath, 'utf8')), n);
setSetting('total_rounds', 10);
loadSetup(setup);
console.log(`Loaded ${setup.count} participants and ${setup.tasks.length} tasks from ${path.basename(setupPath)}.`);
console.log('Login names:', setup.logins.map((l) => l.login_name).join(', '));

if (demo) {
  const players = parseCsv(fs.readFileSync(path.join(dataDir, `round1_players${suffix}.csv`), 'utf8'))
    .map((p) => ({ player_id: p.player_id.toUpperCase(), name: p.name, role: p.role.toLowerCase() }));
  createRound(players, 'ACTIVE');
  console.log('Round 1 created and started with the dummy player names.');
} else {
  console.log('No round yet. Open /host to enter Round 1 names and start it.');
}
