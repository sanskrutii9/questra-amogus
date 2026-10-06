# QUESTRA – Live Task Game

12-player task, scoring and voting game (see `game_architecture.md` for the full design).

**Stack (all open source):** Node.js · Express · Socket.io · SQLite (better-sqlite3) · plain HTML/CSS/JS (no build step).

## Status

| Step | Interface | Status |
|------|-----------|--------|
| 1 | Participant screen (name login + to-do style task list) | ✅ Done |
| 2 | Host login + setup (upload task file, P1–P12 names/roles, start round) | ✅ Done |
| 3 | Host scoring view (live scores, per-point audit, logins, activity feed) | ✅ Done |
| 4 | Host voting control + public voting display | ✅ Done |
| 5 | End round / next round / scorecards | ✅ Done |
| 6 | Emergency meeting button + pop-ups | ✅ Done |
| 7 | Going live on the internet | Next |

See `TODO.md` for the detailed checklist.

## Run it on your Mac

1. Install Node.js 20 or newer (from https://nodejs.org or `brew install node`).
2. Open Terminal **in this folder** (`cd ~/Desktop/QUESTRA/among-us-irl`) and run:

```bash
npm install          # first time only
npm run seed         # resets the game and loads the dummy task file (no round yet)
npm start            # starts the server
```

3. The Terminal prints three things:

```
  Participants:  http://localhost:3000
  Host:          http://localhost:3000/host
  Host password: host-xxxxxx
```

4. **Host:** open http://localhost:3000/host, log in with that password, enter the player names + roles
   (or click *Import names CSV* and pick `data/round1_players.csv`), **Save names**, then **Start Round 1**.
5. **Participants:** open http://localhost:3000 in other tabs/phones and log in with a dummy name below.
6. **Scoring:** after you start a round the host screen switches to the **Scoring** tab. Every tick by a participant
   updates it live. Switching between Setup and Scoring never interrupts participants.
7. **Voting:** on the host **Voting** tab click **Open voting display ↗** and drag that window to the projector
   (press **F** for fullscreen; it's also at http://localhost:3000/display). Click **Start voting** (tasks lock),
   press **+ Vote** for each vote, then **Submit votes & reveal**. The display shows a short suspense screen, then the
   name, vote count and **Impostor / Innocent**. A tie asks you to either add a tie-breaking vote or show "It's a tie".
8. **End the round:** click **End Round N & save scorecard** (Setup tab, or under the result on the Voting tab).
   The scorecard is frozen in the **Scorecards** tab, participants see "Round N complete", and the Setup tab shows a
   fresh **Round N+1 setup** (use **Copy Round N names** if most names stay the same). Save → Start. Every login gets
   5 unchecked tasks again. **Download all as CSV** exports every round's scorecard.
9. **Emergency meetings:** each participant has a red button top-right. Pressing it (and confirming) shows a full-screen
   alert with sound on every other phone and a pop-up on the host screen with how many have pressed OK. Only one meeting
   can be open at a time; the host's **OK · close meeting** re-enables everyone's button.

The host password is created once and kept. To choose your own, start with `HOST_PASSWORD=yourpassword npm start`.

Shortcut: `npm run seed:demo` loads the dummy data *and* starts Round 1 straight away (skips host setup).

## Number of participants (3–20)

The host chooses the number of participants on the **Setup** tab (*Number of participants*), then uploads a task file
with exactly that many: **N login names × 5 tasks = 5N rows**, linked to **P1–PN**, with every player linked to exactly
5 tasks. **Download N-participant sample** gives a ready-made file in the right shape. Uploading a file with a different
number resets all rounds (you're asked first). Everything else (setup rows, scoring, voting cards, display, meetings,
scorecards) adapts to N automatically.

## Dummy data

| Participants | Task file | Round 1 names | Load it |
|---|---|---|---|
| 12 | `data/game_setup.csv` | `data/round1_players.csv` | `npm run seed` |
| 8 | `data/game_setup_8.csv` | `data/round1_players_8.csv` | `npm run seed:8` |
| 6 | `data/game_setup_6.csv` | `data/round1_players_6.csv` | `npm run seed:6` |

Add `-- --demo` to also start Round 1 with the dummy names, e.g. `npm run seed:8 -- --demo`.
Or keep the server running and switch from the host screen: pick the number, upload the matching file.

Login names (the first N are used):

| Login | Name | Login | Name |
|---|---|---|---|
| L1 | 415 | L7 | loby |
| L2 | 416 | L8 | square |
| L3 | 417 | L9 | stairs |
| L4 | 418 | L10 | 407 |
| L5 | 419 | L11 | 414 |
| L6 | 402 | L12 | loby2 |

Names are matched ignoring capital letters and extra spaces.

## Dev tools (optional)

Start the server with temporary dev tools:

```bash
DEV_TOOLS=1 npm start
```

Then, in a second Terminal window:

```bash
# lock tasks (voting)
curl -X POST localhost:3000/api/dev/status -H 'content-type: application/json' -d '{"status":"VOTING"}'
# end the round (participants see the waiting screen)
curl -X POST localhost:3000/api/dev/status -H 'content-type: application/json' -d '{"status":"COMPLETED"}'
# start the next round (everyone gets 5 fresh unchecked tasks)
curl -X POST localhost:3000/api/dev/next-round
```

Open the page on two browser windows logged in as the same name to see ticks sync live.

## Try it from a phone on any network

Quick test using Cloudflare Tunnel (`cloudflared` is open source):

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://….trycloudflare.com` link that works from any phone or network while your Mac is on and the server is running. The link changes each time; a permanent setup is covered in step 7.

## Project layout

```
server/
  index.js      HTTP API + Socket.io realtime
  game.js       game rules (rounds, +1 scoring, what participants may see)
  db.js         SQLite schema
  setupFile.js  task file parser + validation (doc Section 5.1)
  seed.js       loads dummy data
public/         participant screen (index.html, styles.css, app.js); fonts/ (Russo One, OFL)
                host screen at /host (host.html, host.css, host.js)
                public voting display at /display (display.html, display.css, display.js)
data/           CSV files + game.db (created automatically)
```

## Rules already enforced by the server

- A task can only be ticked by the login it belongs to.
- A completed task never gives a second point (checked in the database).
- Tasks can only be ticked while the round is ACTIVE.
- Participants never receive player IDs, player names, roles or scores.
- The host Scoring tab never shows roles (they stay hidden until the voting reveal).
- The public display never receives player IDs, and only receives the role after Submit.
- Votes can only be added while voting is open.
- Scorecards are written once when a round ends and never change afterwards.
- Only one emergency meeting can be open per round (enforced by a database index), and only while tasks are running.
