# 12-Player Task, Scoring & Voting Game

## System Architecture and Functional Requirements

## 1. Overview

The system is a live multiplayer game platform designed for **12
participants** (configurable: the Host can choose any number from 3 to 20;
the rules below use 12 as the example), controlled by a **Host**.

The game has four core mechanisms:

1.  The Host assigns real names to 12 internal player IDs (`P1`--`P12`).
2.  Each of the 12 participant logins receives exactly 5 tasks.
3.  Each task is linked to one internal player ID, and completing the
    task awards **+1 point** to that linked player.
4.  The Host controls a voting system. After votes are submitted, the
    player receiving the maximum votes is publicly revealed along with
    their secret identity: **Innocent** or **Impostor**.

The most important architectural principle is that **participant login
IDs and player IDs are separate entities**.

The game is played as a **session of 10 rounds (games)**. The login →
task → player-ID mapping stays **fixed** for all 10 rounds; only the
real names (and secret roles) behind `P1`--`P12` change each round.
When the Host ends a round, its results are frozen as that round's
scorecard (e.g. **Round 1 Scorecard**), and when the Host starts the
next round all 12 logins see a fresh, fully reset task list. See
**Section 25** for the full multi-round flow.

------------------------------------------------------------------------

# 2. Core Identity Model

The system contains two separate sets of identities.

## 2.1 Participant Login IDs

There are exactly 12 participant logins:

-   `L1`
-   `L2`
-   `L3`
-   ...
-   `L12`

These are **internal IDs**, used for monitoring by the Host and by the
system (the same way `P1`--`P12` are internal IDs for players).

Each login also has a fixed **Login Name**: the name the participant
actually types to log in.

Example:

  Login ID (internal)   Login Name (participant types this)
  --------------------- -------------------------------------
  L1                    Aarav
  L2                    Diya
  L3                    Kabir
  ...                   ...
  L12                   Name

Login names:

-   Are provided by the Host in the **same upload file** as the tasks
    and player allotments, as an extra column (see Section 5.1).
-   Are **fixed for the whole session**. They do not change between
    rounds, no matter how many times a new game is started.
-   Must be **unique** across the 12 logins, because the name itself is
    the login.
-   Are separate from player names. A login name (who is doing the
    tasks) is not a player name (`P1`--`P12`, who receives points and
    changes every round).

A login does **not** represent a player.

## 2.2 Player IDs

There are exactly 12 internal player identities:

-   `P1`
-   `P2`
-   `P3`
-   ...
-   `P12`

The Host privately assigns a real name to each player ID.

Example:

  Player ID   Real Name
  ----------- -----------
  P1          Rahul
  P2          Sneha
  P3          Arjun
  P4          Priya
  ...         ...
  P12         Name

Participants should not see this Host-only mapping.

The system internally operates primarily using `P1`--`P12`.

------------------------------------------------------------------------

# 3. Secret Player Role

When the Host assigns a name to a player, the Host also selects the
player's secret identity:

-   **Innocent**
-   **Impostor**

Example:

  Player ID   Real Name   Secret Role
  ----------- ----------- -------------
  P1          Rahul       Innocent
  P2          Sneha       Impostor
  P3          Arjun       Innocent
  P4          Priya       Innocent
  ...         ...         ...

## Role visibility rules

The secret role is stored by the system but should remain hidden from
participants.

The role must NOT be displayed in:

-   Participant login screens
-   Participant task lists
-   Participant score information
-   Normal scoring interface
-   Normal player scoreboard
-   Voting interface before submission
-   Live voting controls/results before final submission

The role is used only for the **final voting reveal**.

------------------------------------------------------------------------

# 4. Host Setup

The Host has a private control interface.

During setup, the Host sees all 12 internal player IDs.

For every player, the Host enters:

1.  Player name
2.  Secret identity

Example:

``` text
P1

Player Name:
[ Rahul ]

Identity:
( ) Innocent
( ) Impostor
```

The Host repeats this for `P1` through `P12`.

The resulting data might be:

``` text
P1 → Rahul → Innocent
P2 → Sneha → Impostor
P3 → Arjun → Innocent
...
P12 → Name → Impostor
```

This information is stored for the current game/round only. Each new
round starts with a fresh setup screen where the Host enters the names
and roles for that round (see Section 25).

------------------------------------------------------------------------

# 5. Task System

There are exactly:

**12 participant logins × 5 tasks = 60 tasks**

Each login receives exactly 5 tasks.

Each task contains:

-   Task ID
-   Task name
-   Login ID to which the task belongs
-   Player ID to which the task is linked
-   Completion status
-   Optional completion metadata such as completion time

Example:

  Login   Task     Linked Player
  ------- -------- ---------------
  L1      Task A   P4
  L1      Task B   P7
  L1      Task C   P2
  L1      Task D   P11
  L1      Task E   P3
  L2      Task F   P1
  L2      Task G   P5
  ...     ...      ...
  L12     Task     P8

## 5.1 Task upload file

The Host uploads **one file** (CSV or Excel) that defines the whole game
layout: logins, login names, tasks, and player allotments. It is
uploaded once and reused for all rounds.

Columns:

  Column         Meaning                              Example
  -------------- ------------------------------------ ----------------------
  `login_id`     Internal login ID                    `L1`
  `login_name`   Name the participant logs in with    `Aarav`
  `task_id`      Unique task ID                       `T01`
  `task_name`    Task shown to the participant        `Find the hidden clue`
  `player_id`    Player who gets the point            `P4`

Example file (60 rows, 5 per login):

``` text
login_id,login_name,task_id,task_name,player_id
L1,Aarav,T01,Find the hidden clue,P4
L1,Aarav,T02,Fix the wiring,P7
L1,Aarav,T03,Scan the card,P2
L1,Aarav,T04,Empty the trash,P11
L1,Aarav,T05,Align the engine,P3
L2,Diya,T06,Download the data,P1
...
L12,Name,T60,Start the reactor,P8
```

Upload validation (the file is rejected with a clear error if any fail):

-   Exactly 12 login IDs (`L1`--`L12`) and exactly 60 rows.
-   Exactly 5 rows per login ID.
-   Each login ID has the same `login_name` on all of its 5 rows.
-   All 12 login names are different (compared ignoring upper/lower
    case and extra spaces).
-   Every `player_id` is one of `P1`--`P12`.
-   Every `task_id` is unique.

## Critical rule

A task belongs to a **login**, but its score belongs to the **linked
player**.

Therefore:

``` text
Participant Login
       ↓
      Task
       ↓
 Linked Player
       ↓
    Player Score
```

The score should never be permanently associated with the login.

------------------------------------------------------------------------

# 6. Task Distribution

Tasks for a particular player may be distributed across any of the 12
logins.

For example, P1's five tasks could be distributed like this:

  Login   Task     Linked Player
  ------- -------- ---------------
  L2      Task 1   P1
  L5      Task 2   P1
  L7      Task 3   P1
  L9      Task 4   P1
  L12     Task 5   P1

Therefore, P1's score depends on completions across multiple participant
accounts.

If:

-   L2 completes Task 1 → P1 +1
-   L5 completes Task 2 → P1 +1
-   L7 completes Task 3 → P1 +1
-   L9 completes Task 4 → P1 +1
-   L12 completes Task 5 → P1 +1

Then:

**P1 = 5 points**

The login that completed the task does not receive the point.

------------------------------------------------------------------------

# 7. Participant Interface

Each participant logs in by typing their **Login Name**. They never see
or type the internal `L` ID.

No password is required.

> **Accepted risk:** Anyone who types another participant's login name
> can open that participant's task list. This is a deliberate decision
> for the event; no PIN or password will be added.

For example:

``` text
LOGIN

Enter your name:
[ Aarav ]

        [ ENTER ]
```

The system matches the name (ignoring upper/lower case and extra
spaces) to its internal login ID, in this case `L1`. If no login name
matches, the participant sees "Name not found".

After login, they see only the five tasks associated with `L1`, with
their name on screen:

``` text
Hi, Aarav
```

Example:

``` text
MY TASKS

[ ] Task A
[ ] Task B
[ ] Task C
[ ] Task D
[ ] Task E
```

When a participant completes a task, they mark it as completed.

Example:

``` text
[x] Task A
```

The system then:

1.  Marks the task as completed.
2.  Prevents the task from being awarded again.
3.  Identifies the task's linked player.
4.  Adds +1 to that player's score.
5.  Updates the Host's scoring interface.

------------------------------------------------------------------------

# 8. Task Completion Rule

Each task can contribute a maximum of **1 point**.

Therefore:

``` text
Incomplete → Completed = +1
Completed → Completed = No additional point
```

A participant should not be able to repeatedly click a completed task to
generate additional points.

The backend/database should enforce this rule rather than relying only
on frontend controls.

------------------------------------------------------------------------

# 9. Player Scoring

The score belongs to the player ID.

Example:

``` text
Task A
Linked Player = P4
Completed
      ↓
P4 Score +1
```

If P4 has tasks distributed among different logins, all completed tasks
contribute to the same P4 score.

Conceptually:

``` text
P4 Score =
    Completed tasks linked to P4
```

The Host can therefore see the consolidated score regardless of which
login completed the underlying tasks.

------------------------------------------------------------------------

# 10. Host Scoring Interface

The Host has a private scoring/status interface.

It should display all 12 players.

Example:

  Player ID   Player Name     Tasks Completed   Score
  ----------- ------------- ----------------- -------
  P1          Rahul                         4       4
  P2          Sneha                         3       3
  P3          Arjun                         5       5
  P4          Priya                         2       2
  ...         ...                         ...     ...
  P12         Name                          3       3

The Host may also have access to task-level information for auditing.

For example:

``` text
P1
Score: 4

Task 1 → Completed by L2 (Diya)
Task 2 → Completed by L5 (Ishaan)
Task 3 → Completed by L7 (Meera)
Task 4 → Completed by L9 (Rohan)
Task 5 → Pending
```

Wherever the Host interface shows a login, it shows both the internal ID
and the login name, e.g. `L2 (Diya)`.

The Host can also view a **Logins** list for monitoring:

``` text
LOGINS
L1   Aarav    3/5 tasks done   ● online
L2   Diya     5/5 tasks done   ● online
L3   Kabir    0/5 tasks done   ○ offline
...
```

This is useful for identifying exactly where a score came from.

## Role visibility

Even though the Host entered the role during setup, the normal scoring
interface should **not display the secret role**.

The role should remain reserved for the final voting reveal.

------------------------------------------------------------------------

# 11. Host Interface Navigation

The Host's private control window should allow switching between two
major control views.

## A. Participant Scoring / Status View

Used to:

-   Monitor all 12 players
-   View names
-   View scores
-   View task completion
-   Inspect task activity
-   Monitor progress during the round

## B. Voting Control View

Used to:

-   Select/add votes for players
-   View current vote counts
-   Submit the final vote
-   Trigger the public result/reveal

## C. Scorecards View

Used to:

-   Open the frozen scorecard of any finished round (Round 1--10)
-   Compare results across rounds

Scorecards are read-only (see Section 25.5).

The Host should be able to switch between these views at any time.

Example navigation:

``` text
HOST CONTROL PANEL                       ROUND 3 / 10   [ END GAME ]

[ SCORING ]    [ VOTING ]    [ SCORECARDS ]

        ↓

SCORING
or
VOTING
or
SCORECARDS (Round 1, Round 2, ...)
```

Switching views must not interrupt participant task activity.

------------------------------------------------------------------------

# 12. Separate Voting Display Window

The voting interface must have a **separate public display window**.

This is an important architectural requirement.

The Host should have a private control window while a second window can
be displayed to participants/audience using a projector, second monitor,
or shared screen.

The Host should have a button such as:

``` text
OPEN VOTING DISPLAY
```

This opens a separate public-facing voting display.

The public display must not expose Host-only controls.

------------------------------------------------------------------------

# 13. Public Voting Display

The separate voting display is designed for the audience/participants to
see.

Before the vote is submitted, it can display the voting stage.

Example:

``` text
VOTING

Who will receive the most votes?

P1
P2
P3
P4
...
P12
```

The exact visual design can later be made more game-like with
animations, suspense screens, transitions, etc.

The important rule is:

**No secret roles are revealed during the voting stage.**

Implementation note: the display lists the 12 real names in alphabetical order and never shows
`P` IDs (showing them would leak the Host-only P-ID ↔ name mapping). Live vote counts are hidden
by default; the Host can switch them on.

------------------------------------------------------------------------

# 14. Host Voting Controls

The Host privately controls the votes.

The Host sees the 12 real player names.

Example:

``` text
VOTING CONTROL

Rahul       [ + ]   0
Sneha       [ + ]   0
Arjun       [ + ]   0
Priya       [ + ]   0
...
```

Each click on a player's voting button adds one vote.

For example:

``` text
Rahul +1
Rahul +1
Rahul +1

Rahul = 3 votes
```

There is no one-vote-per-player restriction based on the current
requirements.

The same player's button may be clicked multiple times.

------------------------------------------------------------------------

# 15. Vote Submission

The Host eventually presses:

``` text
SUBMIT VOTES
```

The system then:

1.  Calculates the vote count for every player.
2.  Finds the player with the maximum vote count.
3.  Retrieves that player's `P` ID.
4.  Retrieves the corresponding real name.
5.  Retrieves the secret role.
6.  Sends the result to the public voting display.
7.  Reveals the player's name and whether they are an **Innocent** or
    **Impostor**.

------------------------------------------------------------------------

# 16. Final Voting Reveal

Example vote data:

  Player     Votes
  -------- -------
  Rahul          3
  Sneha          8
  Arjun          2
  Priya          5

The maximum is:

``` text
P2 → Sneha → 8 votes
```

The system then checks P2's secret role.

If P2 is an Impostor, the public display reveals:

``` text
SNEHA

8 VOTES

🔴 IMPOSTOR
```

If P2 were Innocent, it would instead reveal:

``` text
SNEHA

8 VOTES

🟢 INNOCENT
```

The final reveal is the **only point where the secret role is exposed to
the public interface**.

------------------------------------------------------------------------

# 17. End-to-End System Flow

``` text
                    HOST
                      │
                      ▼
              ROUND SETUP
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
    Assign P1-P12           Task file (once):
    names + roles           60 tasks + player
    (every round)           links + 12 login
          │                 names
          │                        │
          │                        │
          └───────────┬────────────┘
                      ▼
                  START ROUND
                      │
                      ▼
              12 PARTICIPANTS
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
         L1          L2          L3 ... L12
          │           │           │
          ▼           ▼           ▼
        5 Tasks     5 Tasks     5 Tasks
          │           │           │
          └───────────┼───────────┘
                      ▼
              Task Completion
                      │
                      ▼
              Linked Player ID
                      │
                      ▼
                  +1 SCORE
                      │
                      ▼
             HOST SCOREBOARD
                      │
                      │
              Host switches
              to Voting View
                      │
                      ▼
              VOTING CONTROL
                      │
                      ▼
             Separate Display
                      │
                      ▼
               SUBMIT VOTES
                      │
                      ▼
             Highest Vote Player
                      │
              ┌───────┴────────┐
              ▼                ▼
          Player Name       Secret Role
              │                │
              └───────┬────────┘
                      ▼
                PUBLIC REVEAL
                      │
                      ▼
                  END GAME
                      │
                      ▼
          Save "Round N Scorecard"
                      │
                      ▼
            N < 10 ? ── yes ──> START NEW GAME
                      │         (back to ROUND SETUP,
                      no         same tasks, new names,
                      │          all 12 logins reset)
                      ▼
               SESSION COMPLETE
```

------------------------------------------------------------------------

# 18. Recommended Data Model

Because the task layout is reused for all 10 rounds, the data is split
into **fixed data** (defined once) and **per-round data** (recreated
each round).

``` text
FIXED (defined once, reused every round)
  logins          L1–L12 + fixed login names
  player_slots    P1–P12
  task_templates  60 tasks: login_id + player_id + task_name

PER ROUND (new rows every round)
  rounds          Round 1 … Round 10
  round_players   names + roles for P1–P12 in this round
  task_progress   which tasks are completed in this round
  votes           vote counts in this round
  scorecards      frozen snapshot when the round ends
```

## Sessions

``` text
sessions
--------
session_id
total_rounds      (default 10)
current_round_id
created_at
```

------------------------------------------------------------------------

## Logins (fixed)

``` text
logins
------
login_id      → L1–L12 (internal, for monitoring)
login_name    → name the participant logs in with (unique)
session_id
```

Filled from the `login_name` column of the task upload file. Unique on
`(session_id, lower(trim(login_name)))`. Never changes between rounds.

------------------------------------------------------------------------

## Task Templates (fixed)

``` text
task_templates
--------------
task_id
login_id     → L1–L12 (who sees the task)
player_id    → P1–P12 (who gets the point)
task_name
```

Uploaded once. Never changes between rounds.

------------------------------------------------------------------------

## Round Players (per round)

``` text
round_players
-------------
round_id
player_id    → P1–P12
name         → real name entered by Host this round
role         → innocent / impostor
```

Primary key: `(round_id, player_id)`.

------------------------------------------------------------------------

## Task Progress (per round)

``` text
task_progress
-------------
round_id
task_id
completed      (true / false)
completed_at
completed_by   → login_id
```

Primary key: `(round_id, task_id)`. Because completion is stored per
round, starting a new round automatically gives every login 5 unchecked
tasks without touching the task templates. The +1 rule (Section 8) is
enforced per round.

------------------------------------------------------------------------

## Rounds

``` text
rounds
------
round_id
session_id
round_number       → 1–10
status             → SETUP / ACTIVE / VOTING / REVEALED / COMPLETED
created_at
started_at
ended_at
result_player_id
```

------------------------------------------------------------------------

## Scorecards (per round, frozen)

``` text
scorecards
----------
round_id
round_number
player_id
name
role
tasks_completed
score
votes
was_voted_out   (true / false)
```

Written once when the Host presses END GAME; read-only afterwards.

------------------------------------------------------------------------

## Meetings (per round)

`meetings` and `meeting_acks` store emergency meetings for each round.
See Section 26.6.

------------------------------------------------------------------------

## Original single-round model (for reference)

The tables below describe the original single-round design. In the
multi-round design, `players` becomes `round_players`, and the
completion fields of `tasks` move to `task_progress`.

## Players

``` text
players
-------
player_id
name
role
round_id
```

Where:

-   `player_id` = P1--P12
-   `name` = real name entered by Host
-   `role` = innocent / impostor
-   `round_id` = identifies the game round

------------------------------------------------------------------------

## Participant Logins

``` text
logins
------
login_id
round_id
```

Where:

-   `login_id` = L1--L12
-   `round_id` = current game round

No password is required under the current requirements. (In the
multi-round design, logins also carry a fixed `login_name` and are not
tied to a round; see "Logins (fixed)" above.)

------------------------------------------------------------------------

## Tasks

``` text
tasks
-----
task_id
login_id
player_id
task_name
completed
completed_at
completed_by
round_id
```

Important relationships:

``` text
login_id  → Who receives the task
player_id → Who receives the point
```

------------------------------------------------------------------------

## Votes

``` text
votes
-----
vote_id
player_id
vote_count
round_id
```

The voting system is separate from task scoring.

------------------------------------------------------------------------

## Rounds

``` text
rounds
------
round_id
status
created_at
started_at
voting_status
result_player_id
```

Possible statuses could include:

``` text
SETUP
ACTIVE
VOTING
REVEALED
COMPLETED
```

------------------------------------------------------------------------

# 19. Key Relationships

The architecture can be summarized with these relationships:

``` text
LOGIN
  │
  │ owns
  ▼
TASK
  │
  │ linked to
  ▼
PLAYER
  │
  ├── has NAME
  │
  ├── has SECRET ROLE
  │
  └── accumulates SCORE
```

Voting operates separately:

``` text
PLAYER
  │
  │ receives
  ▼
VOTES
  │
  ▼
HIGHEST VOTE
  │
  ▼
PLAYER
  │
  ├── NAME
  └── SECRET ROLE
         │
         ▼
   PUBLIC REVEAL
```

------------------------------------------------------------------------

# 20. Separation of Information

The system should enforce clear information boundaries.

## Participant

Can see:

-   Their own login name
-   Their five tasks
-   Task completion status

Should NOT see:

-   Their internal login ID (`L1`--`L12`)
-   Other participants' login names (exception: the caller's login name
    is shown on an emergency meeting pop-up, see Section 26)

-   Other login tasks
-   Player real names
-   Player roles
-   Other players' scores
-   Internal task-to-player mappings

## Host

Can see:

-   P1--P12
-   Real names
-   Task assignments
-   Task completion
-   Player scores
-   Voting controls
-   Vote counts
-   Secret roles during setup/control if needed

However, the normal scoring view should not display roles to preserve
the game's intended reveal flow.

## Public Voting Display

Can see:

-   Voting-stage information
-   Vote/result presentation
-   Final revealed player name
-   Final revealed identity: Innocent/Impostor

Should NOT see:

-   Host controls
-   Login IDs
-   Task assignments
-   Private task activity
-   Secret roles before the final reveal
-   Other Host-only information

------------------------------------------------------------------------

# 21. Important Business Rules

### Rule 1: Exactly 12 participant logins

``` text
L1–L12
```

### Rule 2: Exactly 12 player IDs

``` text
P1–P12
```

### Rule 3: Five tasks per login

``` text
12 × 5 = 60 tasks
```

### Rule 4: Every task has exactly one linked player

``` text
Task → P1/P2/.../P12
```

### Rule 5: Completing a task awards exactly +1 to its linked player

``` text
Task completed → Linked Player +1
```

### Rule 6: A completed task cannot award another point

Repeated clicks must not generate additional points.

### Rule 7: A player's tasks may be distributed across any logins

The score must be aggregated by player ID.

### Rule 8: Login identity and player identity are separate

``` text
L1 ≠ P1
```

There is no requirement that they correspond.

### Rule 9: Real names are Host-controlled

Participants operate through internal IDs/game logic.

### Rule 10: Secret roles are only for final reveal

``` text
Innocent / Impostor
```

### Rule 11: Voting is independent of task scoring

Task points and votes are separate systems.

### Rule 12: A player's vote count may increase multiple times

The Host can repeatedly select the same player.

### Rule 13: Voting controls are private

The public display must not expose the Host's control interface.

### Rule 14: Voting display is a separate window

The Host can display it independently while retaining the private
control window.

### Rule 15: Host can switch between scoring and voting control

The Host does not need to leave the game or disrupt participant sessions
to switch views.

### Rule 16: Final reveal identifies the highest-voted player

The system retrieves:

``` text
Highest-voted Player ID
        ↓
Player Name
        ↓
Secret Role
```

and reveals the result publicly.

### Rule 17: A session has 10 rounds

``` text
Round 1 → Round 2 → ... → Round 10
```

### Rule 18: Task layout is fixed across rounds

The same 60 tasks, the same login → task mapping, and the same task →
player-ID mapping are used in every round.

### Rule 19: Names and roles are per round

The Host enters new names (and roles) for `P1`--`P12` at the start of
every round. A name from one round never carries into another round's
scores.

### Rule 20: Scores, completions and votes reset every round

Every round starts at 0 points, 0 votes, and all 60 tasks unchecked.

### Rule 21: Ending a round freezes its scorecard

END GAME saves "Round N Scorecard". It can be viewed later but never
edited.

### Rule 22: Participants never need to log in again

The 12 logins stay signed in across all rounds; their screens refresh
automatically when a new round starts.

### Rule 23: Participants log in by fixed login name

Each `L` ID has one fixed, unique login name, supplied in the task
upload file. Participants type the name; `L1`--`L12` stay internal for
Host monitoring.

``` text
"Aarav" → L1 → 5 tasks
```

Login names never change between rounds. Player names (`P1`--`P12`)
are separate and change every round.

### Rule 24: Any participant can call an emergency meeting

A corner button on every participant screen sends a pop-up to all other
participants and the Host. Each person clicks OK to dismiss it.

### Rule 25: Only one meeting at a time

While a meeting is open, all meeting buttons are disabled. The meeting
closes when the Host clicks OK.

### Rule 26: Meetings only during an ACTIVE round

The button does nothing during setup, voting, reveal, or between
rounds.

------------------------------------------------------------------------

# 22. Example Complete Scenario

Suppose the Host creates:

``` text
P1 → Rahul → Innocent
P2 → Sneha → Impostor
P3 → Arjun → Innocent
```

The Host uploads tasks.

One task belonging to L7 is:

``` text
Task: Find the hidden clue
Linked Player: P2
```

The L7 participant completes it.

The system records:

``` text
L7 completed Task X
Task X → P2
P2 score = P2 score + 1
```

Later, another participant from L3 completes a different task linked to
P2.

Now:

``` text
P2 score = 2
```

The score belongs to Sneha/P2 regardless of which logins completed the
tasks.

Later, the Host opens the voting control.

Votes become:

``` text
P1 → 4
P2 → 9
P3 → 2
...
```

The Host submits.

The system determines:

``` text
Highest vote = P2
Name = Sneha
Role = Impostor
```

The separate public window then displays:

``` text
━━━━━━━━━━━━━━━━━━━━

       SNEHA

       9 VOTES

      🔴 IMPOSTOR

━━━━━━━━━━━━━━━━━━━━
```

The Host can then return to the scoring interface without closing the
game.

------------------------------------------------------------------------

# 23. High-Level Technical Architecture

A suitable implementation should use a shared backend/database because
multiple participant sessions and the Host interface must observe the
same game state.

A possible stack is:

``` text
Frontend
React / Next.js
        │
        ▼
Backend / API
        │
        ▼
Shared Database
        │
        ├── Players
        ├── Logins
        ├── Tasks
        ├── Votes
        └── Rounds
```

A service such as Supabase can be used for the shared database and
real-time synchronization.

The frontend should not be trusted as the sole authority for scoring.

For example, the backend should verify that:

``` text
Task belongs to Login
AND
Task is not already completed
```

before awarding the point.

------------------------------------------------------------------------

# 24. Architecture Principle

The entire game can be reduced to five independent concepts:

``` text
LOGIN
Who is performing the task?

TASK
What must they complete?

PLAYER
Who receives the point?

ROLE
Is that player Innocent or Impostor?

VOTE
Who received the most votes?
```

The critical relationships are:

``` text
LOGIN ──owns──> TASK ──awards point to──> PLAYER

PLAYER ──has hidden──> ROLE

PLAYER ──receives──> VOTES

HIGHEST VOTE ──reveals──> PLAYER NAME + ROLE
```

This separation should be maintained throughout the UI, database, and
backend implementation.

------------------------------------------------------------------------

# 25. Multi-Round Hosting (10 Games)

The same game is hosted **10 times in a row** with the same 12
participant logins. Each hosting is one **round**.

## 25.1 What stays the same vs. what changes

  Item                                   Every round
  -------------------------------------- ------------------------------
  Login IDs `L1`--`L12`                  Same
  Login names (Aarav, Diya, ...)         Same (from upload file)
  Player IDs `P1`--`P12`                 Same
  60 tasks and their names               Same
  Which login gets which task            Same
  Which player ID each task points to    Same
  Real names behind `P1`--`P12`          **Changes** (Host enters)
  Secret roles (Innocent / Impostor)     **Changes** (Host enters)
  Task completion status                 **Reset** to unchecked
  Player scores                          **Reset** to 0
  Votes                                  **Reset** to 0

In short: the *game layout* is fixed, the *people and results* are new
each round.

## 25.2 Round lifecycle

``` text
┌──────────────────────────────────────────────────────────┐
│ ROUND N                                                  │
│                                                          │
│ 1. SETUP     Host enters names + roles for P1–P12        │
│ 2. ACTIVE    Host presses START; logins complete tasks   │
│ 3. VOTING    Host adds votes, opens public display       │
│ 4. REVEALED  Host submits; top-voted player revealed     │
│ 5. COMPLETED Host presses END GAME                       │
│              → "Round N Scorecard" is saved              │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
             Host presses START NEW GAME
                          │
                          ▼
                    ROUND N + 1 (SETUP)
```

After Round 10 is ended, START NEW GAME is replaced by
**SESSION COMPLETE**, and only the scorecards remain available.

## 25.3 Host: END GAME

The Host presses:

``` text
END GAME
```

The system then:

1.  Asks for confirmation ("End Round 3? This cannot be undone.").
2.  Takes a snapshot of every player's name, role, tasks completed,
    score, votes, and whether they were voted out.
3.  Saves the snapshot as **Round N Scorecard**.
4.  Locks the round: no more task completions or votes are accepted
    for it (enforced by the backend).
5.  Moves all 12 participant screens to a waiting screen.
6.  Moves the public display to a "Round N complete" screen.

If the Host ends a round before voting, the scorecard is still saved
and its vote result shows "No vote held".

## 25.4 Host: START NEW GAME

The Host presses:

``` text
START NEW GAME
```

The system then:

1.  Creates Round N + 1 with status `SETUP`.
2.  Shows the Host the setup screen for `P1`--`P12` with empty name and
    role fields.
3.  Creates 60 fresh task-progress rows (all unchecked) from the fixed
    task templates.
4.  Sets all 12 vote counts to 0.

When the Host has entered all names and roles and presses START, the
round becomes `ACTIVE`.

## 25.5 Scorecards

Each finished round has a read-only scorecard, opened from the
**SCORECARDS** tab of the Host panel.

Example:

``` text
ROUND 1 SCORECARD                         Ended: 6:42 PM

Player  Name     Role       Tasks  Score  Votes
------  -------  ---------  -----  -----  -----
P1      Rahul    Innocent   4/5    4      3
P2      Sneha    Impostor   3/5    3      8   ← Voted out
P3      Arjun    Innocent   5/5    5      2
...
P12     Name     Impostor   3/5    3      1

Result: SNEHA — 8 votes — IMPOSTOR
```

``` text
SCORECARDS

[ Round 1 ]  [ Round 2 ]  [ Round 3 ]  ...  [ Round 10 ]
```

Notes:

-   Roles are shown on scorecards because the round has ended; the
    scorecards are still Host-only.
-   A scorecard reflects that round's names. P2 may be "Sneha" in
    Round 1 and "Karan" in Round 2; the two rounds are never mixed.
-   Scorecards cannot be edited after END GAME.

## 25.6 Participant experience across rounds

Participants log in once with their login name (e.g. "Aarav", which is
`L1` internally) and stay logged in for all 10 rounds. If they reload
or switch devices, they log in again with the same name and land in
the current round.

``` text
Round ACTIVE            Round ended             New round started
-------------           -------------           -----------------
MY TASKS                ROUND 1 COMPLETE        MY TASKS  (Round 2)
[x] Task A              Waiting for the         [ ] Task A
[x] Task B              host to start the       [ ] Task B
[ ] Task C              next round...           [ ] Task C
[x] Task D                                      [ ] Task D
[ ] Task E                                      [ ] Task E
```

-   The refresh happens automatically through real-time updates; no
    manual reload or re-login is needed.
-   During `SETUP` (while the Host enters names), participants see the
    waiting screen and cannot tick tasks.
-   Every round shows the same 5 task names, all unchecked again.
-   Participants still never see names, roles, scores, or the round's
    scorecard.

## 25.7 Backend enforcement

Every task completion request must check:

``` text
Round is ACTIVE
AND Task belongs to Login
AND Task is not already completed in THIS round
```

Every vote request must check that the round is in `VOTING`. Requests
for a round that is `COMPLETED` are rejected, so a late click from a
participant who hadn't refreshed can never change a saved scorecard.

## 25.8 Open questions

-   Should the setup screen pre-fill the previous round's names as a
    starting point, or always start empty? (Current assumption: empty.)
-   Should there be a combined 10-round leaderboard? It is not possible
    by player ID, because a P ID means a different person each round;
    it would have to be summed by **name** across scorecards.
-   ~~How should a tie for the most votes be handled?~~ **Decided:** on a tie the Host either adds a
    tie-breaking vote, or submits it as a tie; the display then shows "It's a tie" and nobody's role is revealed.

------------------------------------------------------------------------

# 26. Emergency Meeting Button

Every participant has a **meeting button** fixed in the corner of their
screen. Pressing it sends a pop-up to all other participants and the
Host at the same time.

## 26.1 Participant screen

``` text
┌────────────────────────────────────┐
│ Hi, Aarav                   [ 🚨 ] │  ← meeting button (top-right)
│                                    │
│ MY TASKS                           │
│ [x] Task A                         │
│ [ ] Task B                         │
│ ...                                │
└────────────────────────────────────┘
```

-   The button is always visible while the round is `ACTIVE`.
-   It is hidden or disabled during `SETUP`, `VOTING`, `REVEALED`, and
    on the waiting screen between rounds.
-   Pressing it asks for a quick confirmation ("Call a meeting?
    YES / NO") so it isn't triggered by accident.

## 26.2 What happens when it is pressed

1.  The participant's app sends a "call meeting" request to the backend.
2.  The backend checks that the round is `ACTIVE` and that no other
    meeting is already open.
3.  The backend creates a meeting record and broadcasts it in real time.
4.  Every other logged-in participant and the Host get a pop-up within
    about a second.
5.  The caller's screen shows "Meeting called" in place of the pop-up.

## 26.3 The pop-up

Participants see:

``` text
┌───────────────────────────────┐
│                               │
│     🚨 EMERGENCY MEETING 🚨   │
│                               │
│     Called by: Aarav          │
│                               │
│            [ OK ]             │
│                               │
└───────────────────────────────┘
```

-   The pop-up covers the task list, so it can't be missed.
-   It closes only when the participant clicks **OK**.
-   A participant who is offline or reconnects while the meeting is
    still open sees the pop-up as soon as they are back.

The Host sees the same pop-up, plus who has acknowledged it:

``` text
┌───────────────────────────────┐
│     🚨 EMERGENCY MEETING 🚨   │
│     Called by: L1 (Aarav)     │
│     Time: 6:21 PM             │
│                               │
│     Acknowledged: 9 / 11      │
│     Waiting: L4 (Neha),       │
│              L10 (Om)         │
│                               │
│            [ OK ]             │
└───────────────────────────────┘
```

## 26.4 Closing a meeting

-   Each participant's pop-up closes when they click OK.
-   The **meeting itself is closed when the Host clicks OK**. This marks
    the meeting as handled.
-   Only one meeting can be open at a time. While a meeting is open,
    every participant's meeting button is disabled; it re-enables for
    everyone as soon as the Host clicks OK.

What happens next (discussion, moving to voting, etc.) is up to the
Host; the button only calls everyone together.

## 26.5 Meeting log

Every meeting is logged per round and shown to the Host:

-   In the Scoring view, as a small "Meetings this round" list
    (time, caller).
-   On the round's scorecard, as "Meetings called: 2 (Aarav 6:21 PM,
    Kabir 6:34 PM)".

Meetings do not affect scores or votes.

## 26.6 Data model

``` text
meetings
--------
meeting_id
round_id
called_by     → login_id (L1–L12)
called_at
status        → OPEN / CLOSED
closed_at

meeting_acks
------------
meeting_id
acked_by      → login_id, or HOST
acked_at
```

Backend rules:

``` text
Call meeting allowed only if:
    Round is ACTIVE
    AND no meeting in this round is OPEN

Host OK → meeting status = CLOSED → buttons re-enabled
```

The "only one open meeting" check must be done in the database (for
example a unique index on `round_id` where `status = OPEN`), so two
participants pressing the button at the same moment create only one
meeting. The second caller just receives the existing meeting's pop-up.

## 26.7 Open questions

-   Should there be a limit on how many meetings each participant can
    call per round (Among Us uses 1 per player)? Current assumption: no
    limit.
-   Should the public voting display also flash "EMERGENCY MEETING"?
    Current assumption: no.
-   Should task completions pause while a meeting is open? Current
    assumption: no; participants can continue after clicking OK.
