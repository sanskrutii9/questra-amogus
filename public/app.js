// Participant interface: log in with a name, see 5 tasks, tick them off.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'questra_token';

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  let token = store.get();
  let state = null;
  let socket = null;
  let pendingTask = null;   // task waiting for confirmation in the sheet
  let lastKey = null;
  let alarmedFor = null;    // meeting id we already played the alarm for       // "round:status", to notice when a round starts

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(false); throw new Error(body.error || 'Please log in again.'); }
    if (!res.ok) { const e = new Error(body.error || 'Something went wrong.'); e.body = body; throw e; }
    return body;
  }

  // ---------- views ----------
  function show(view) {
    for (const v of ['login', 'wait', 'tasks']) $(`view-${v}`).hidden = v !== view;
  }

  function render() {
    if (!token || !state) { show('login'); return; }
    const r = state.round;

    // Round just started? Let the participant know their list is ready.
    const key = r ? `${r.number}:${r.status}` : 'none';
    if (lastKey && key !== lastKey && r?.status === 'ACTIVE' && !lastKey.startsWith(`${r.number}:V`) && !lastKey.startsWith(`${r.number}:R`)) {
      toast(`Round ${r.number} has started. Go!`);
    }
    lastKey = key;

    if (!r || r.status === 'SETUP' || r.status === 'COMPLETED') {
      $('alert').hidden = true;
      show('wait');
      if (!r) {
        $('wait-title').textContent = `Hi ${state.name}`;
        $('wait-text').textContent = 'Waiting for the host to start the game.';
      } else if (r.status === 'SETUP') {
        $('wait-title').textContent = `Round ${r.number} is starting soon`;
        $('wait-text').textContent = `Hi ${state.name}, the host is setting up. Your tasks will appear here.`;
      } else if (r.number >= state.totalRounds) {
        $('wait-title').textContent = 'That was the last round';
        $('wait-text').textContent = `Thanks for playing, ${state.name}!`;
      } else {
        $('wait-title').textContent = `Round ${r.number} complete`;
        $('wait-text').textContent = 'Waiting for the host to start the next round…';
      }
      return;
    }

    show('tasks');
    renderMeeting();
    const locked = r.status !== 'ACTIVE';
    $('round-label').textContent = `Round ${r.number} / ${state.totalRounds}`;
    $('hello').textContent = `Hi, ${state.name}`;
    $('locked').hidden = !locked;
    $('view-tasks').classList.toggle('locked', locked);

    const done = state.tasks.filter((t) => t.done).length;
    const total = state.tasks.length || 5;
    const pct = Math.round((done / total) * 100);
    $('progress-text').textContent = `${done} of ${total} done`;
    $('progress-pct').textContent = `${pct}%`;
    $('bar-fill').style.width = `${pct}%`;
    $('all-done').hidden = done !== total;

    const list = $('task-list');
    list.replaceChildren(...state.tasks.map((t) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task' + (t.done ? ' done' : '');
      btn.disabled = t.done || locked;
      btn.setAttribute('aria-pressed', String(t.done));
      btn.innerHTML = '<span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="#062320" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="task-name"></span>';
      btn.querySelector('.task-name').textContent = t.name;
      btn.addEventListener('click', () => openSheet(t));
      li.appendChild(btn);
      return li;
    }));
  }

  // ---------- emergency meeting ----------
  function renderMeeting() {
    const m = state.meeting;
    const btn = $('meeting-btn');
    btn.hidden = state.round?.status !== 'ACTIVE' && !m;
    btn.disabled = !state.canCallMeeting;
    btn.classList.toggle('open', !!m);
    btn.title = m ? 'A meeting is in progress' : 'Call an emergency meeting';

    const showAlert = !!m && !m.acked;
    $('alert').hidden = !showAlert;
    if (showAlert) {
      $('alert-by').textContent = m.calledBy;
      if (alarmedFor !== m.id) { alarmedFor = m.id; window.playAlarm?.(); }
    }
  }

  $('meeting-btn').addEventListener('click', () => { if (state.canCallMeeting) $('msheet').hidden = false; });
  $('msheet-no').addEventListener('click', () => { $('msheet').hidden = true; });
  $('msheet').addEventListener('click', (e) => { if (e.target === $('msheet')) $('msheet').hidden = true; });
  $('msheet-yes').addEventListener('click', async () => {
    $('msheet').hidden = true;
    try {
      state = await api('/api/meeting', { method: 'POST' });
      if (state.meeting?.mine) { alarmedFor = state.meeting.id; toast('Meeting called. Everyone has been alerted.'); }
      render();
    } catch (e) {
      if (e.body?.state) { state = e.body.state; render(); }
      toast(e.message);
    }
  });
  $('alert-ok').addEventListener('click', async () => {
    const m = state.meeting;
    $('alert').hidden = true;
    if (!m) return;
    try { state = await api(`/api/meeting/${m.id}/ack`, { method: 'POST' }); render(); } catch {}
  });

  // ---------- confirm sheet ----------
  function openSheet(task) {
    pendingTask = task;
    $('sheet-title').textContent = task.name;
    $('sheet').hidden = false;
    $('sheet-confirm').disabled = false;
  }
  function closeSheet() { $('sheet').hidden = true; pendingTask = null; }

  $('sheet-cancel').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
  $('sheet-confirm').addEventListener('click', async () => {
    if (!pendingTask) return;
    const task = pendingTask;
    $('sheet-confirm').disabled = true;
    closeSheet();
    markPending(task.id, true);
    try {
      const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/complete`, { method: 'POST' });
      state = res.state;
      render();
    } catch (e) {
      if (e.body?.state) state = e.body.state;
      render();
      toast(e.message);
    }
  });

  function markPending(taskId, on) {
    const idx = state.tasks.findIndex((t) => t.id === taskId);
    const btn = $('task-list').children[idx]?.querySelector('.task');
    if (btn) { btn.classList.toggle('pending', on); btn.disabled = true; }
  }

  // ---------- login / logout ----------
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('login-name').value;
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ name }) });
      token = res.token;
      store.set(token);
      state = res.state;
      lastKey = state.round ? `${state.round.number}:${state.round.status}` : 'none';
      connectSocket();
      render();
    } catch (err) {
      $('login-error').textContent = err.message;
    } finally {
      $('login-btn').disabled = false;
    }
  });

  async function logout(callServer = true) {
    if (callServer && token) { try { await api('/api/logout', { method: 'POST' }); } catch {} }
    token = null; state = null; lastKey = null;
    store.clear();
    if (socket) { socket.disconnect(); socket = null; }
    $('login-name').value = '';
    render();
  }
  document.querySelectorAll('[data-action="logout"]').forEach((b) => b.addEventListener('click', () => logout()));

  // ---------- realtime ----------
  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { token } });
    socket.on('connect', () => { $('offline').hidden = true; refresh(); });
    socket.on('disconnect', () => { $('offline').hidden = false; });
    socket.on('state', (s) => { state = s; render(); });
    socket.on('round:changed', () => refresh());
    socket.on('meeting:update', () => refresh());
  }

  async function refresh() {
    if (!token) return;
    try { state = await api('/api/me'); render(); } catch {}
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  // ---------- boot ----------
  if (token) {
    api('/api/me').then((s) => { state = s; lastKey = s.round ? `${s.round.number}:${s.round.status}` : 'none'; connectSocket(); render(); })
      .catch(() => render());
  } else {
    render();
  }
})();
