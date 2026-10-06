# Build checklist

## Step 1: Participant screen ✅
- [x] Project skeleton (Express + Socket.io + SQLite)
- [x] Dummy task file: 12 login names, 60 tasks, P1–P12 links
- [x] Dummy Round 1 player names + roles
- [x] Login by name (no password), stays logged in after reload
- [x] To-do style list of 5 tasks with progress bar
- [x] "Mark as done?" confirm, server-enforced +1 (no double points)
- [x] Live sync across devices; refresh on new round
- [x] Waiting screens (setup / round complete / last round), locked banner during voting

## Step 2: Host login + setup ✅
- [x] Host login (password printed in Terminal, or HOST_PASSWORD)
- [x] Upload task file (CSV) with clear validation errors; confirm before replacing
- [x] Logins panel: 12 fixed names, online dots, each login's 5 tasks → player
- [x] Enter P1–P12 names + Innocent/Impostor (or import CSV / copy previous round)
- [x] Save names (participants see "Round N is starting soon") → Start Round N
- [x] Names/roles locked once the round is live; "Hide roles" toggle

## Step 3: Host scoring view ✅
- [x] Working tabs: Setup ↔ Scoring (auto-opens Scoring when a round starts)
- [x] Stat tiles: round + live timer, tasks completed /60, participants online, leading player
- [x] Live table P1–P12: name, 5-pip progress, score, last point; sort by ID or score; row flashes on +1
- [x] Per-player audit: each task, which login (e.g. `L2 (Diya)`) completed it and when
- [x] Logins panel: online dot, tasks done /5, last activity, each task → player
- [x] Live activity feed ("Diya (L2) completed … +1 Karan (P5)")
- [x] No roles anywhere on the Scoring tab

## Step 4: Voting ✅
- [x] Start voting (locks all task lists) / Resume tasks
- [x] Host voting control: + Vote / − per player, total, leader, reset
- [x] Submit votes → highest vote revealed; tie → add a tie-break vote or show "It's a tie"
- [x] Separate public display window (/display): idle → voting names → suspense → name + votes + Impostor/Innocent
- [x] Optional "show live counts on display" toggle (off by default)
- [x] Display never gets player IDs; role only after submit

## Step 5: Rounds and scorecards ✅
- [x] "End Round N & save scorecard" (Setup tab + Voting result), with confirmation
- [x] Frozen scorecard: names, roles, tasks, score, votes, voted out, meetings ("No vote held" if no reveal)
- [x] Next round setup opens automatically (Copy Round N names); all logins reset to 5 unchecked tasks
- [x] Scorecards tab: Round 1–10 chips, read-only table, Download all as CSV

## Step 6: Emergency meeting ✅
- [x] Red corner button on participant screen (only while tasks are running) + "Call a meeting?" confirm
- [x] Full-screen alert with sound + vibration for every other participant; OK to dismiss; reappears after reload until OK
- [x] Host pop-up: caller, time, "x / 11 acknowledged", who is still waiting; OK closes the meeting
- [x] One meeting at a time (database-enforced); buttons disabled while open
- [x] Meeting log in Scoring tab and on the scorecard; ending a round closes any open meeting

## Extra: any number of participants ✅
- [x] Host picks 3–20 participants; upload validated for N logins × 5 tasks, P1–PN, 5 tasks per player
- [x] Sample file download for any N; dummy datasets for 6, 8 and 12 (`npm run seed:6`, `seed:8`, `seed`)
- [x] Setup rows, scoring, voting, display, meetings and scorecards all follow N

## Extra: space theme ✅
- [x] Black starry sky, red/blue/green/orange/white elements, bundled heading font
- [x] Reveal shows only name + identity; whole screen red (Impostor) or green (Innocent)

## Step 7: Go live
- [ ] Permanent public URL (named Cloudflare Tunnel or a small VPS)
- [ ] Remove DEV_TOOLS endpoints
