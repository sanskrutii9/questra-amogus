// Host control panel: login, task file upload, round setup (P1–PN names + roles), start round.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'questra_host_token';
  // Number of participants comes from the loaded task file (3–20).
  const count = () => state?.setup?.count || 12;
  const pids = () => Array.from({ length: count() }, (_, i) => `P${i + 1}`);
  let pcountTouched = false;   // host changed the participant selector
  const STATUS_LABEL = { SETUP: 'Setup', ACTIVE: 'Live', VOTING: 'Voting', REVEALED: 'Revealed', COMPLETED: 'Ended' };

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  let token = store.get();
  let state = null;
  let socket = null;
  let draft = null;        // [{player_id, name, role}] being edited
  let draftRound = null;   // round number the draft belongs to
  const openLogins = new Set();

  // scoring tab
  let scoring = null;
  let sortBy = 'id';
  const openPlayers = new Set();
  const openScoreLogins = new Set();
  const prevScores = new Map();   // player_id -> last seen score (to flash rows that just scored)
  const bumpUntil = new Map();    // player_id -> timestamp
  let scoringRound = null;

  // voting tab
  let voting = null;
  let votePending = 0;

  // scorecards + meetings
  let scards = [];
  let scSelected = null;      // round number being viewed
  let lastMeetingId = null;   // to play the alarm once per new meeting     // vote clicks still in flight (keep local counts until they settle)
  const TAB_KEY = 'questra_host_tab';
  let activeTab = (() => { try { return localStorage.getItem(TAB_KEY) || 'setup'; } catch { return 'setup'; } })();

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/host/login') { logout(false); throw new Error('Please log in again.'); }
    if (!res.ok) { const e = new Error(body.error || 'Something went wrong.'); e.body = body; e.status = res.status; throw e; }
    return body;
  }

  // ---------- helpers ----------
  const blankDraft = () => pids().map((id) => ({ player_id: id, name: '', role: 'innocent' }));
  const norm = (list) => JSON.stringify((list || []).map((p) => [p.player_id, p.name.trim(), p.role]));
  const serverPlayers = () => (state.form.players.length ? state.form.players : null);
  const isDirty = () => {
    if (!draft) return false;
    const sp = serverPlayers();
    return sp ? norm(draft) !== norm(sp) : draft.some((p) => p.name.trim());
  };
  const roundSaved = () => state.round && state.round.status === 'SETUP' && state.round.number === state.form.roundNumber;

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => n.append(c));
    return n;
  }

  function showErrors(listEl, head, items = []) {
    listEl.replaceChildren();
    if (!head && !items.length) { listEl.hidden = true; return; }
    if (head) listEl.append(el('li', { class: 'head', text: head }));
    items.forEach((t) => listEl.append(el('li', { text: t })));
    listEl.hidden = false;
  }

  // ---------- render ----------
  function render() {
    $('view-login').hidden = !!(token && state);
    $('view-dash').hidden = !(token && state);
    if (!token || !state) return;

    // Draft follows the server unless the host has unsaved edits for the same round.
    if (draftRound !== state.form.roundNumber || !isDirty()) {
      draft = (serverPlayers() || blankDraft()).map((p) => ({ ...p }));
      draftRound = state.form.roundNumber;
    }

    renderHeader();
    renderTabs();
    renderForm();
    renderFile();
    renderScoring();
    renderVoting();
    renderEndButtons();
    renderScorecards();
    renderMeeting();
  }

  // ---------- tabs ----------
  function renderTabs() {
    document.querySelectorAll('.tab[data-tab]').forEach((t) => {
      const on = t.dataset.tab === activeTab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('tab-setup').hidden = activeTab !== 'setup';
    $('tab-scoring').hidden = activeTab !== 'scoring';
    $('tab-voting').hidden = activeTab !== 'voting';
    $('tab-scorecards').hidden = activeTab !== 'scorecards';
  }
  function setTab(name) {
    activeTab = name;
    try { localStorage.setItem(TAB_KEY, name); } catch {}
    renderTabs();
  }
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  // ---------- scoring tab ----------
  const fmtTime = (iso, secs = false) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}) }) : '—');
  const pips = (n, total = 5) => el('div', { class: 'pips', role: 'img', 'aria-label': `${n} of ${total}` },
    Array.from({ length: total }, (_, i) => el('i', { class: i < n ? 'on' : '' })));

  function renderScoring() {
    const sc = scoring;
    const ready = sc && sc.ready;
    $('score-empty').hidden = !!ready;
    $('score-body').hidden = !ready;
    if (!ready) {
      const r = sc?.round;
      $('score-empty').textContent = !state.setup.loaded ? 'Upload the task file in the Setup tab first.'
        : r?.status === 'SETUP' ? `Round ${r.number} hasn't started yet. Start it from the Setup tab.`
        : 'No round yet. Set up Round 1 in the Setup tab.';
      return;
    }

    // New round: forget previous scores so nothing flashes.
    if (scoringRound !== sc.round.number) { prevScores.clear(); scoringRound = sc.round.number; }

    // stats
    $('st-round').textContent = `Round ${sc.round.number}`;
    tickTimer();
    $('st-done').textContent = sc.totals.done;
    $('st-total').textContent = sc.totals.total;
    $('st-meter').style.width = `${sc.totals.total ? (sc.totals.done / sc.totals.total) * 100 : 0}%`;
    $('st-online').textContent = sc.totals.online;
    $('st-online-total').textContent = ` / ${sc.logins.length}`;
    const offline = sc.logins.filter((l) => !l.online).map((l) => l.login_name);
    $('st-offline').textContent = !offline.length ? 'Everyone is connected' : offline.length <= 4 ? `Offline: ${offline.join(', ')}` : `${offline.length} offline`;
    const max = Math.max(...sc.players.map((p) => p.score));
    const leaders = sc.players.filter((p) => p.score === max);
    $('st-lead').textContent = max > 0 ? leaders[0].name : '—';
    $('st-lead-sub').textContent = max > 0
      ? `${leaders[0].player_id} · ${max} point${max === 1 ? '' : 's'}${leaders.length > 1 ? ` · tied with ${leaders.length - 1} more` : ''}`
      : 'No points yet';

    // players
    const now = Date.now();
    sc.players.forEach((p) => {
      if (prevScores.has(p.player_id) && p.score > prevScores.get(p.player_id)) {
        bumpUntil.set(p.player_id, now + 1600);
        setTimeout(() => document.querySelector(`[data-pid="${p.player_id}"]`)?.classList.remove('bump'), 1650);
      }
      prevScores.set(p.player_id, p.score);
    });
    const list = [...sc.players];
    if (sortBy === 'score') list.sort((a, b) => b.score - a.score || (a.last_at || '').localeCompare(b.last_at || '') || Number(a.player_id.slice(1)) - Number(b.player_id.slice(1)));
    $('players').replaceChildren(...list.map((p) => {
      const d = el('details', { class: `srow${(bumpUntil.get(p.player_id) || 0) > now ? ' bump' : ''}`, 'data-pid': p.player_id, open: openPlayers.has(p.player_id) },
        el('summary', {},
          el('span', { class: 'who' }, el('span', { class: 'id', text: p.player_id }), el('span', { class: 'nm', text: p.name })),
          pips(p.score, p.total),
          el('span', { class: 'num score', text: String(p.score) }),
          el('span', { class: 'num when', text: p.last_at ? fmtTime(p.last_at) : '—' })),
        el('ul', { class: 'audit' }, p.tasks.map((t) => el('li', { class: t.done ? 'done' : '' },
          el('span', { class: 'tick', text: t.done ? '✓' : '' }),
          el('span', { class: 't' }, t.task_name, el('small', { text: `  ·  ${t.login_id} (${t.login_name})` })),
          el('span', { class: 'meta', text: t.done ? `+1 at ${fmtTime(t.done_at)}` : 'Pending' })))));
      d.addEventListener('toggle', () => (d.open ? openPlayers.add(p.player_id) : openPlayers.delete(p.player_id)));
      return d;
    }));

    // logins
    $('score-logins').replaceChildren(...sc.logins.map((l) => {
      const d = el('details', { class: 'srow lrow', open: openScoreLogins.has(l.login_id) },
        el('summary', {},
          el('span', { class: 'who' },
            el('i', { class: `dot${l.online ? ' on' : ''}`, title: l.online ? 'Online' : 'Offline' }),
            el('span', { class: 'id', text: l.login_id }), el('span', { class: 'nm', text: l.login_name })),
          pips(l.done, l.total),
          el('span', { class: 'num', text: `${l.done}/${l.total}` }),
          el('span', { class: 'num when', text: l.last_at ? fmtTime(l.last_at) : '—' })),
        el('ul', { class: 'audit' }, l.tasks.map((t) => el('li', { class: t.done ? 'done' : '' },
          el('span', { class: 'tick', text: t.done ? '✓' : '' }),
          el('span', { class: 't' }, t.task_name, el('small', { text: `  →  ${t.player_id} (${t.player_name || '?'})` })),
          el('span', { class: 'meta', text: t.done ? fmtTime(t.done_at) : 'Pending' })))));
      d.addEventListener('toggle', () => (d.open ? openScoreLogins.add(l.login_id) : openScoreLogins.delete(l.login_id)));
      return d;
    }));

    // meetings this round
    $('meeting-log').replaceChildren(...(sc.meetings?.length ? sc.meetings.map((m) => el('li', {},
      el('time', { datetime: m.called_at, text: fmtTime(m.called_at, true) }),
      el('span', {}, el('b', { text: m.login_name }), el('span', { class: 'muted', text: ` (${m.login_id}) called a meeting` })),
      el('span', { class: m.status === 'OPEN' ? 'tag out' : 'muted', text: m.status === 'OPEN' ? 'Open' : 'Closed' })))
      : [el('li', { class: 'feed-empty', text: 'No meetings called this round.' })]));

    // feed
    $('feed').replaceChildren(...(sc.feed.length ? sc.feed.map((f) => el('li', {},
      el('time', { datetime: f.at, text: fmtTime(f.at, true) }),
      el('span', {}, el('b', { text: f.login_name }), el('span', { class: 'muted', text: ` (${f.login_id}) completed ` }), f.task_name),
      el('span', { class: 'plus', text: `+1 ${f.player_name} (${f.player_id})` })))
      : [el('li', { class: 'feed-empty', text: 'No tasks completed yet. Completions appear here live.' })]));
  }

  function tickTimer() {
    const r = scoring?.round;
    if (!scoring?.ready || !r?.startedAt) return;
    const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now();
    const secs = Math.max(0, Math.floor((end - new Date(r.startedAt).getTime()) / 1000));
    const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    const label = { ACTIVE: `Live · ${mmss}`, VOTING: `Voting · tasks locked at ${mmss}`, REVEALED: 'Result revealed', COMPLETED: `Ended · lasted ${mmss}` }[r.status] || r.status;
    $('st-timer').textContent = label;
  }
  setInterval(() => { if (activeTab === 'scoring' && scoring?.round?.status === 'ACTIVE') tickTimer(); }, 1000);

  document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    sortBy = b.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    renderScoring();
  }));

  function renderHeader() {
    const r = state.round;
    const pill = $('round-pill');
    pill.className = 'pill' + (r?.status === 'ACTIVE' ? ' live' : r?.status === 'SETUP' ? ' setup' : '');
    pill.textContent = r ? `Round ${r.number} / ${state.totalRounds} · ${STATUS_LABEL[r.status]}` : 'No round yet';
    $('online-text').textContent = `${state.onlineCount} / ${count()} online`;
    $('online-pill').querySelector('.dot').classList.toggle('on', state.onlineCount > 0);
  }

  function renderForm() {
    const f = state.form;
    const r = state.round;
    const loaded = state.setup.loaded;
    const allDone = f.roundNumber > state.totalRounds;
    const editable = loaded && f.editable;

    $('form-title').textContent = allDone ? 'All rounds played' : `Round ${f.roundNumber} setup`;
    let sub = '';
    if (!loaded) sub = 'Upload the task file first.';
    else if (allDone) sub = `All ${state.totalRounds} rounds are finished.`;
    else if (roundSaved()) sub = `Saved. Participants see "Round ${f.roundNumber} is starting soon".`;
    else if (editable && r?.status === 'COMPLETED') sub = `Round ${r.number} ended and its scorecard is saved. Enter the names for Round ${f.roundNumber}, save, then start.`;
    else if (editable) sub = 'Enter the real name and secret role for each player, then save.';
    $('form-sub').textContent = sub;

    const banner = $('form-banner');
    if (r && ['ACTIVE', 'VOTING', 'REVEALED'].includes(r.status) && r.number === f.roundNumber) {
      banner.hidden = false;
      banner.className = 'banner ok';
      banner.textContent = `Round ${r.number} is ${r.status === 'ACTIVE' ? 'live' : r.status.toLowerCase()}. Names and roles are locked for this round.`;
    } else banner.hidden = true;

    // toolbar
    $('form-tools').hidden = !editable;
    const prev = state.previousRound;
    $('copy-prev').hidden = !(editable && prev);
    if (prev) $('copy-prev').textContent = `Copy Round ${prev.number} names`;

    // rows
    const table = $('ptable');
    if (!loaded || allDone) {
      table.replaceChildren(el('div', { class: 'empty', text: loaded ? 'Nothing left to set up.' : 'Upload the task file to set up a round.' }));
    } else {
      table.replaceChildren(...draft.map((p, i) => playerRow(p, i, editable)));
    }

    renderFormFoot(editable, allDone);
  }

  function playerRow(p, i, editable) {
    const row = el('div', { class: `prow ${p.role}` }, el('span', { class: 'pid', text: p.player_id }));
    if (editable) {
      const input = el('input', {
        type: 'text', value: p.name, placeholder: `Name for ${p.player_id}`, maxlength: '40',
        'aria-label': `${p.player_id} name`,
        oninput: (e) => { draft[i].name = e.target.value; e.target.classList.remove('invalid'); renderFormFoot(true, false); },
      });
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': `${p.player_id} role` },
        ['innocent', 'impostor'].map((role) => el('button', {
          type: 'button', class: `${role}${p.role === role ? ' on' : ''}`, text: role === 'innocent' ? 'Innocent' : 'Impostor',
          'aria-pressed': String(p.role === role),
          onclick: () => { draft[i].role = role; renderForm(); },
        })));
      row.append(input, seg);
    } else {
      row.append(el('span', { class: 'readonly', text: p.name || '—' }),
        el('span', { class: `role-tag ${p.role}`, text: p.role === 'impostor' ? 'Impostor' : 'Innocent' }));
    }
    return row;
  }

  function renderFormFoot(editable, allDone) {
    const imp = draft.filter((p) => p.role === 'impostor').length;
    const named = draft.filter((p) => p.name.trim()).length;
    const countEl = $('role-count');
    countEl.textContent = state.setup.loaded && !allDone
      ? `${named} / ${count()} names · ${imp} impostor${imp === 1 ? '' : 's'} · ${count() - imp} innocent` + (imp === 0 ? ' · ⚠ no impostors selected' : '')
      : '';

    const dirty = isDirty();
    const saved = roundSaved();
    const save = $('save-btn');
    const start = $('start-btn');
    const showActions = editable;
    save.hidden = start.hidden = !showActions;
    save.disabled = !dirty;
    save.textContent = saved ? 'Save changes' : 'Save names';
    start.textContent = `Start Round ${state.form.roundNumber}`;
    start.disabled = !(saved && !dirty);

    let hint = '';
    if (showActions) {
      if (dirty && saved) hint = 'You have unsaved changes. Save them before starting.';
      else if (!saved) hint = 'Save the names first. Then you can start the round.';
      else hint = `Ready. ${state.onlineCount} / ${count()} participants connected. When you start, everyone sees their 5 tasks.`;
    }
    $('start-hint').textContent = hint;
  }

  function renderFile() {
    const s = state.setup;
    const sel = $('pcount');
    if (!pcountTouched && s.loaded) sel.value = String(s.count);
    const chosen = Number(sel.value);
    $('sample-link').href = `/host/sample.csv?n=${chosen}`;
    $('sample-link').textContent = `Download ${chosen}-participant sample`;
    $('pcount-hint').textContent = !s.loaded
      ? `Upload a file with ${chosen} participants: ${chosen} login names × 5 tasks = ${chosen * 5} rows, linked to P1–P${chosen}.`
      : chosen === s.count
        ? `File format: ${chosen} login names × 5 tasks = ${chosen * 5} rows, linked to P1–P${chosen}.`
        : `Current file has ${s.count} participants. Upload ${[8, 11, 18].includes(chosen) ? 'an' : 'a'} ${chosen}-participant file (${chosen * 5} rows) to switch. This resets all rounds.`;
    $('file-status').textContent = s.loaded ? `Loaded: ${s.count} participants · ${s.taskCount} tasks` : 'No task file yet. Upload one to begin.';
    const names = new Map((state.form.players || []).map((p) => [p.player_id, p.name]));
    const box = $('logins');
    if (!s.loaded) { box.replaceChildren(el('div', { class: 'empty', text: 'Logins appear here after you upload the task file.' })); return; }
    box.replaceChildren(...s.logins.map((l) => {
      const d = el('details', { class: 'login', open: openLogins.has(l.login_id) },
        el('summary', {},
          el('span', { class: 'lid', text: l.login_id }),
          el('span', { class: 'lname', text: l.login_name }),
          el('i', { class: `dot${l.online ? ' on' : ''}`, title: l.online ? 'Online' : 'Offline' })),
        el('ol', {}, l.tasks.map((t) => el('li', {},
          el('b', { text: t.task_name }), ` → ${t.player_id}${names.get(t.player_id) ? ' · ' + names.get(t.player_id) : ''}`))));
      d.addEventListener('toggle', () => (d.open ? openLogins.add(l.login_id) : openLogins.delete(l.login_id)));
      return d;
    }));
  }

  // ---------- voting tab ----------
  function renderVoting() {
    const v = voting;
    const status = v?.round?.status;
    const show = (id, on) => { $(id).hidden = !on; };
    $('show-counts').checked = !!v?.showCounts;

    if (!v || !v.ready) {
      show('vote-empty', true); show('vote-start', false); show('vote-live', false); show('vote-result', false);
      $('vote-empty').textContent = v?.round?.status === 'SETUP'
        ? `Round ${v.round.number} hasn't started yet. Start it from the Setup tab.`
        : 'No round is running. Set one up in the Setup tab.';
      $('vote-status').textContent = 'Nothing to vote on yet.';
      return;
    }
    show('vote-empty', status === 'COMPLETED');
    if (status === 'COMPLETED') $('vote-empty').textContent = `Round ${v.round.number} has ended.`;
    show('vote-start', status === 'ACTIVE');
    show('vote-live', status === 'VOTING');
    show('vote-result', status === 'REVEALED' || (status === 'COMPLETED' && !!v.result));
    $('vote-status').textContent = {
      ACTIVE: `Round ${v.round.number} · tasks running`,
      VOTING: `Round ${v.round.number} · voting open, tasks locked`,
      REVEALED: `Round ${v.round.number} · result revealed`,
      COMPLETED: `Round ${v.round.number} · ended`,
    }[status];

    if (status === 'VOTING') {
      const max = Math.max(...v.players.map((p) => p.votes));
      const leaders = v.players.filter((p) => p.votes === max && max > 0);
      $('vote-total').textContent = v.total;
      $('vote-lead').textContent = !leaders.length ? '—'
        : leaders.length > 1 ? `Tie · ${leaders.map((p) => p.name).join(', ')} (${max})` : `${leaders[0].name} (${max})`;
      $('submit-votes').disabled = v.total === 0;
      $('vote-grid').replaceChildren(...v.players.map((p) => el('div', { class: `vcard${max > 0 && p.votes === max ? ' lead' : ''}` },
        el('div', { class: 'vname' }, el('small', { text: p.player_id }), p.name),
        el('div', { class: 'vcount', text: String(p.votes), 'aria-live': 'polite' }),
        el('div', { class: 'vbtns' },
          el('button', { type: 'button', class: 'btn minus', 'aria-label': `Remove a vote from ${p.name}`, disabled: p.votes === 0, onclick: () => vote(p.player_id, -1), text: '−' }),
          el('button', { type: 'button', class: 'btn plus', 'aria-label': `Add a vote for ${p.name}`, onclick: () => vote(p.player_id, 1), text: '+ Vote' })))));
    }

    if (v.result) {
      const r = v.result;
      $('result-main').replaceChildren(...(r.type === 'tie'
        ? [el('span', { class: 'rname', text: "It's a tie" }), el('span', { class: 'role-badge tie', text: 'NO ONE REVEALED' }),
           el('span', { class: 'rvotes', text: `${r.tied.join(' & ')} · ${r.votes} votes each` })]
        : [el('span', { class: 'rname', text: r.name }), el('span', { class: 'rvotes', text: `${r.votes} vote${r.votes === 1 ? '' : 's'}` }),
           el('span', { class: `role-badge ${r.role}`, text: r.role.toUpperCase() })]));
      const top = Math.max(...v.players.map((p) => p.votes));
      $('result-table').replaceChildren(...[...v.players].sort((a, b) => b.votes - a.votes).map((p) =>
        el('div', { class: p.votes === top ? 'top' : '' }, el('span', { text: `${p.player_id} · ${p.name}` }), el('b', { text: String(p.votes) }))));
    }
  }

  async function vote(playerId, delta) {
    const p = voting.players.find((x) => x.player_id === playerId);
    if (!p || (delta < 0 && p.votes === 0)) return;
    p.votes += delta; voting.total += delta;   // optimistic
    votePending++;
    renderVoting();
    try {
      const res = await api(`/api/host/votes/${playerId}`, { method: 'POST', body: JSON.stringify({ delta }) });
      votePending--;
      if (!votePending) { voting = res; renderVoting(); }
    } catch (e) {
      votePending--;
      toast(e.message);
      refresh();
    }
  }

  async function votingAction(path, body, okMsg) {
    try {
      voting = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      await refresh();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      if (e.body?.tie) return e;
      toast(e.message);
      return false;
    }
  }

  $('start-voting').addEventListener('click', async () => {
    const ok = await confirmModal('Start voting?', "Every participant's task list locks. The public display switches to the voting screen.", 'Start voting');
    if (ok) votingAction('/api/host/voting/start', null, 'Voting is open. Tasks are locked.');
  });
  $('resume-tasks').addEventListener('click', async () => {
    const ok = await confirmModal('Resume tasks?', 'Voting closes and participants can tick tasks again. Votes so far are kept.', 'Resume tasks');
    if (ok) votingAction('/api/host/voting/resume', null, 'Tasks resumed.');
  });
  $('reset-votes').addEventListener('click', async () => {
    const ok = await confirmModal('Reset all votes?', 'Every vote count goes back to 0.', 'Reset votes');
    if (ok) votingAction('/api/host/votes/reset', null, 'Votes reset.');
  });
  $('submit-votes').addEventListener('click', async () => {
    const max = Math.max(...voting.players.map((p) => p.votes));
    const top = voting.players.filter((p) => p.votes === max);
    if (top.length > 1) {
      const ok = await confirmModal("It's a tie", `${top.map((p) => p.name).join(' and ')} have ${max} votes each. Submit as a tie (nobody is revealed), or cancel and add a tie-breaking vote.`, 'Submit as tie');
      if (ok) votingAction('/api/host/voting/submit', { allowTie: true }, 'Tie shown on the display.');
      return;
    }
    const text = `${top[0].name} has the most votes (${max}). Their name and secret role will appear on the public display.`;
    if (!(await confirmModal('Submit votes and reveal?', text, 'Submit & reveal'))) return;
    const res = await votingAction('/api/host/voting/submit', { allowTie: false }, 'Result revealed on the display.');
    if (res && res.body?.tie) toast('Votes changed: it is now a tie. Check the counts and submit again.');
  });
  $('show-counts').addEventListener('change', (e) => votingAction('/api/host/display-settings', { showCounts: e.target.checked },
    e.target.checked ? 'Display now shows live counts.' : 'Display hides counts until the reveal.'));
  $('open-display').addEventListener('click', () => {
    window.open('/display', 'questra-display', 'popup,width=1280,height=720');
  });

  // ---------- end round ----------
  function renderEndButtons() {
    const r = state.round;
    const live = r && ['ACTIVE', 'VOTING', 'REVEALED'].includes(r.status);
    $('end-box').hidden = !live;
    document.querySelectorAll('[data-action="end-round"]').forEach((b) => {
      if (r) b.textContent = `End Round ${r.number} & save scorecard`;
      b.disabled = !live;
    });
  }

  document.querySelectorAll('[data-action="end-round"]').forEach((b) => b.addEventListener('click', async () => {
    const r = state.round;
    const noVote = r.status !== 'REVEALED';
    const text = `This saves the Round ${r.number} Scorecard and cannot be undone. Participants see a waiting screen until the next round starts.`
      + (noVote ? ' No vote has been revealed in this round, so the scorecard will say "No vote held".' : '');
    if (!(await confirmModal(`End Round ${r.number}?`, text, `End Round ${r.number}`))) return;
    try {
      state = await api('/api/host/round/end', { method: 'POST' });
      draft = null; draftRound = null;
      scSelected = r.number;
      setTab('setup');
      await refresh();
      toast(`Round ${r.number} saved to Scorecards. Set up Round ${r.number + 1}.`);
    } catch (e) { toast(e.message); }
  }));

  // ---------- scorecards ----------
  function renderScorecards() {
    const has = scards.length > 0;
    $('sc-empty').hidden = has;
    $('sc-body').hidden = !has;
    $('download-csv').disabled = !has;
    if (!has) return;
    if (!scards.some((c) => c.round_number === scSelected)) scSelected = scards[scards.length - 1].round_number;
    $('sc-rounds').replaceChildren(...scards.map((c) => el('button', {
      type: 'button', role: 'tab', class: `chip${c.round_number === scSelected ? ' on' : ''}`, 'aria-selected': String(c.round_number === scSelected),
      text: `Round ${c.round_number}`, onclick: () => { scSelected = c.round_number; renderScorecards(); },
    })));
    const c = scards.find((x) => x.round_number === scSelected);
    $('sc-title').textContent = `Round ${c.round_number} Scorecard`;
    const dur = c.started_at && c.ended_at ? Math.round((new Date(c.ended_at) - new Date(c.started_at)) / 1000) : null;
    $('sc-times').textContent = `Ended ${fmtTime(c.ended_at)}` + (dur != null ? ` · lasted ${Math.floor(dur / 60)} min ${dur % 60} s` : '');
    const r = c.result;
    $('sc-result').replaceChildren(...(r.type === 'player'
      ? [el('span', { class: 'rname', text: r.name }), el('span', { class: 'rvotes', text: `voted out with ${r.votes} vote${r.votes === 1 ? '' : 's'}` }),
         el('span', { class: `role-badge ${r.role}`, text: r.role.toUpperCase() })]
      : r.type === 'tie'
        ? [el('span', { class: 'rname', text: "It's a tie" }), el('span', { class: 'rvotes', text: `${r.tied.join(' & ')} · ${r.votes} each` })]
        : [el('span', { class: 'role-badge none', text: 'NO VOTE HELD' })]));
    $('sc-rows').replaceChildren(...c.players.map((p) => el('tr', { class: p.was_voted_out ? 'out' : '' },
      el('td', { class: 'pid', text: p.player_id }),
      el('td', { class: 'nm', text: p.name }),
      el('td', {}, el('span', { class: `tag ${p.role}`, text: p.role === 'impostor' ? 'Impostor' : 'Innocent' })),
      el('td', { class: 'num', text: `${p.tasks_completed}/5` }),
      el('td', { class: 'num', text: String(p.score) }),
      el('td', { class: 'num', text: String(p.votes) }),
      el('td', {}, p.was_voted_out ? el('span', { class: 'tag out', text: 'Voted out' }) : ''))));
    $('sc-meetings').textContent = c.meetings.length
      ? `Meetings called: ${c.meetings.length} (${c.meetings.map((m) => `${m.login_name} ${fmtTime(m.called_at)}`).join(', ')})`
      : 'No meetings called.';
  }

  $('download-csv').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/host/scorecards.csv', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed.');
      const url = URL.createObjectURL(await res.blob());
      const a = el('a', { href: url, download: 'questra_scorecards.csv' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast(e.message); }
  });

  // ---------- emergency meeting pop-up ----------
  function renderMeeting() {
    const m = state.meeting;
    $('meeting').hidden = !m;
    if (!m) { lastMeetingId = null; return; }
    if (m.id !== lastMeetingId) { lastMeetingId = m.id; window.playAlarm?.(); }
    $('mt-by').textContent = `${m.calledBy.login_id} (${m.calledBy.login_name})`;
    $('mt-time').textContent = `at ${fmtTime(m.calledAt, true)}`;
    $('mt-ack').textContent = `${m.ackedCount} / ${m.otherCount}`;
    $('mt-meter').style.width = `${(m.ackedCount / m.otherCount) * 100}%`;
    $('mt-waiting').textContent = m.waiting.length
      ? `Waiting: ${m.waiting.map((l) => `${l.login_id} (${l.login_name})`).join(', ')}`
      : 'Everyone has seen it.';
  }

  $('mt-ok').addEventListener('click', async () => {
    const m = state.meeting;
    if (!m) return;
    $('mt-ok').disabled = true;
    try { state = await api(`/api/host/meeting/${m.id}/close`, { method: 'POST' }); render(); }
    catch (e) { toast(e.message); }
    finally { $('mt-ok').disabled = false; }
  });

  // participant count selector (3–20)
  for (let n = 3; n <= 20; n++) $('pcount').append(el('option', { value: String(n), text: `${n} participants` }));
  $('pcount').value = '12';
  $('pcount').addEventListener('change', () => { pcountTouched = true; renderFile(); });

  // ---------- actions ----------
  $('save-btn').addEventListener('click', async () => {
    showErrors($('form-errors'));
    $('save-btn').disabled = true;
    try {
      state = await api('/api/host/round/players', { method: 'POST', body: JSON.stringify({ players: draft }) });
      draft = null; draftRound = null;
      render();
      toast('Names saved.');
    } catch (e) {
      showErrors($('form-errors'), e.message, e.body?.details);
      (e.body?.details || []).forEach((msg) => {
        const idx = pids().indexOf(msg.split(':')[0]);
        if (idx >= 0 && /name|already/.test(msg)) $('ptable').children[idx]?.querySelector('input')?.classList.add('invalid');
      });
      renderFormFoot(true, false);
    }
  });

  $('start-btn').addEventListener('click', async () => {
    const n = state.form.roundNumber;
    const ok = await confirmModal(`Start Round ${n}?`, 'Participants will immediately see their 5 tasks. Names and roles get locked for this round.', 'Start round');
    if (!ok) return;
    try {
      state = await api('/api/host/round/start', { method: 'POST' });
      scoring = await api('/api/host/scoring');
      activeTab = 'scoring';
      try { localStorage.setItem(TAB_KEY, activeTab); } catch {}
      render();
      toast(`Round ${n} started. Showing live scores.`);
    } catch (e) { toast(e.message); }
  });

  $('copy-prev').addEventListener('click', () => {
    draft = state.previousRound.players.map((p) => ({ ...p }));
    renderForm();
  });

  $('hide-roles').addEventListener('change', (e) => $('round-panel').classList.toggle('roles-hidden', e.target.checked));

  $('import-players').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const lines = (await file.text()).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const head = lines.shift().toLowerCase().split(',').map((h) => h.trim());
    const [iId, iName, iRole] = ['player_id', 'name', 'role'].map((h) => head.indexOf(h));
    if (iId < 0 || iName < 0) { toast('CSV needs columns: player_id, name, role'); return; }
    let n = 0;
    lines.forEach((line) => {
      const c = line.split(',').map((x) => x.trim());
      const idx = pids().indexOf((c[iId] || '').toUpperCase());
      if (idx < 0) return;
      draft[idx].name = c[iName] || '';
      if (iRole >= 0 && /^(innocent|impostor)$/i.test(c[iRole] || '')) draft[idx].role = c[iRole].toLowerCase();
      n++;
    });
    renderForm();
    toast(`Imported ${n} players. Review, then save.`);
  });

  $('upload-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const csv = await file.text();
    showErrors($('file-errors'));
    const send = (confirm) => api('/api/host/setup-file', { method: 'POST', body: JSON.stringify({ csv, confirm, count: Number($('pcount').value) }) });
    try {
      state = await send(false);
    } catch (err) {
      if (err.body?.needsConfirm) {
        const ok = await confirmModal('Replace the task file?', err.body.error, 'Replace and reset');
        if (!ok) return;
        try { state = await send(true); } catch (e2) { showErrors($('file-errors'), e2.message, e2.body?.details); return; }
      } else {
        showErrors($('file-errors'), err.message, err.body?.details);
        return;
      }
    }
    draft = null; draftRound = null; pcountTouched = false;
    render();
    toast(`Task file loaded: ${state.setup.count} participants (${file.name})`);
  });

  // ---------- modal / toast ----------
  function confirmModal(title, text, okLabel) {
    return new Promise((resolve) => {
      $('modal-title').textContent = title;
      $('modal-text').textContent = text;
      $('modal-ok').textContent = okLabel || 'Yes, continue';
      $('modal').hidden = false;
      const done = (v) => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; resolve(v); };
      $('modal-ok').onclick = () => done(true);
      $('modal-cancel').onclick = () => done(false);
    });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  // ---------- login / logout / realtime ----------
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      const res = await api('/api/host/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
      token = res.token;
      store.set(token);
      await refresh();
      connect();
    } catch (err) {
      $('login-error').textContent = err.message;
    } finally {
      $('login-btn').disabled = false;
    }
  });

  async function logout(callServer = true) {
    if (callServer && token) { try { await api('/api/host/logout', { method: 'POST' }); } catch {} }
    token = null; state = null; draft = null; draftRound = null;
    store.clear();
    if (socket) { socket.disconnect(); socket = null; }
    $('password').value = '';
    render();
  }
  $('logout-btn').addEventListener('click', () => logout());

  async function refresh() {
    if (!token) return;
    try {
      const [s, sc, v, cards] = await Promise.all([api('/api/host/state'), api('/api/host/scoring'), api('/api/host/voting'), api('/api/host/scorecards')]);
      state = s; scoring = sc; scards = cards;
      if (!votePending) voting = v;
      render();
    } catch {}
  }

  let refreshTimer;
  function connect() {
    if (socket) socket.disconnect();
    socket = io({ auth: { hostToken: token } });
    socket.on('connect', () => { $('offline').hidden = true; refresh(); });
    socket.on('disconnect', () => { $('offline').hidden = false; });
    socket.on('host:update', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150); });
  }

  // ---------- boot ----------
  if (token) refresh().then(() => { if (state) connect(); else render(); });
  else render();
})();
