// Public voting display. Read-only: shows idle / voting / reveal screens.
(() => {
  const $ = (id) => document.getElementById(id);
  const STAGES = ['s-idle', 's-voting', 's-suspense', 's-result'];
  let last = null;          // last state we rendered
  let revealTimer = null;

  const showStage = (id) => STAGES.forEach((s) => { $(s).hidden = s !== id; });

  function render(s) {
    const prevStatus = last?.round?.status;
    const prevRound = last?.round?.number;
    last = s;
    const r = s.round;
    const status = r?.status;

    if (status === 'VOTING') {
      clearTimeout(revealTimer);
      showStage('s-voting');
      $('voting-kicker').textContent = `Round ${r.number} · Voting`;
      const counts = s.names.some((n) => n.votes !== null);
      $('names').replaceChildren(...s.names.map((n) => {
        const c = document.createElement('div');
        c.className = 'nm-card' + (counts ? '' : ' only');
        const name = document.createElement('span');
        name.textContent = n.name;
        c.append(name);
        if (counts) { const b = document.createElement('b'); b.textContent = n.votes; c.append(b); }
        return c;
      }));
      $('voting-foot').textContent = counts ? `${s.total} vote${s.total === 1 ? '' : 's'} so far` : 'Votes are being counted…';
      return;
    }

    if (status === 'REVEALED' && s.result) {
      fillResult(s.result);
      // Animate only when we watched the vote close live; on reload show the result straight away.
      if (prevStatus === 'VOTING' && prevRound === r.number) {
        showStage('s-suspense');
        clearTimeout(revealTimer);
        revealTimer = setTimeout(() => {
          $('s-result').classList.add('animate');
          showStage('s-result');
        }, 2600);
      } else if ($('s-suspense').hidden) {
        $('s-result').classList.remove('animate');
        showStage('s-result');
      }
      return;
    }

    clearTimeout(revealTimer);
    showStage('s-idle');
    $('idle-text').textContent = !r ? 'Waiting for the game to start'
      : status === 'SETUP' ? `Round ${r.number} is starting soon`
      : status === 'ACTIVE' ? `Round ${r.number} / ${s.totalRounds} · Tasks in progress`
      : r.number >= s.totalRounds ? 'Thanks for playing!'
      : `Round ${r.number} complete`;
  }

  function fillResult(res) {
    const stage = $('s-result');
    stage.classList.remove('impostor', 'innocent', 'tie');
    if (res.type === 'tie') {
      stage.classList.add('tie');
      $('result-name').textContent = "It's a tie";
      $('result-role').textContent = 'No one revealed';
    } else {
      stage.classList.add(res.role);
      $('result-name').textContent = res.name;
      $('result-role').textContent = res.role === 'impostor' ? 'Impostor' : 'Innocent';
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/display/state');
      render(await res.json());
    } catch {}
  }

  const socket = io({ auth: { display: true } });
  socket.on('connect', refresh);
  socket.on('display:update', refresh);

  // fullscreen + idle cursor
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  $('fs').addEventListener('click', toggleFs);
  document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
  let idle;
  const wake = () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
  };
  document.addEventListener('mousemove', wake);
  wake();

  refresh();
})();
