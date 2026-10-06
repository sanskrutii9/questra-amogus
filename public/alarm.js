// Short two-tone alert for emergency meetings (Web Audio, no sound files needed).
// Browsers only allow sound after the person has tapped/clicked the page once; failures are ignored.
window.playAlarm = (() => {
  let ctx = null;
  return function playAlarm() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 660 : 880, t0 + i * 0.22);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
      gain.gain.setValueAtTime(0.18, t0 + 1.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.4);
    } catch {}
    try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch {}
  };
})();
