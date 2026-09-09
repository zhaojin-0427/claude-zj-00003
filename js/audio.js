/* =========================================================
 * 极简音效合成器（WebAudio，无外部音频资源）
 * ========================================================= */
const Sfx = {
  ctx: null,
  muted: false,

  init() {
    try { this.muted = localStorage.getItem(LS_MUTE) === '1'; } catch (e) { /* ignore */ }
  },

  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  beep(freq, dur, type, vol, delay) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  },

  click()   { this.beep(660, 0.05, 'square', 0.06); },
  place()   { this.beep(520, 0.07, 'triangle', 0.12); },
  merge()   { this.beep(392, 0.09, 'triangle', 0.13); this.beep(523, 0.09, 'triangle', 0.11, 0.07); },
  success() { this.beep(523, 0.10, 'sine', 0.13); this.beep(659, 0.10, 'sine', 0.13, 0.09); this.beep(784, 0.14, 'sine', 0.13, 0.18); },
  error()   { this.beep(150, 0.20, 'sawtooth', 0.10); },
  alarm()   { this.beep(880, 0.13, 'square', 0.09); this.beep(660, 0.16, 'square', 0.09, 0.13); },
  dock()    { this.beep(330, 0.08, 'sine', 0.10); this.beep(440, 0.10, 'sine', 0.10, 0.08); },

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(LS_MUTE, this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    return this.muted;
  },
};
Sfx.init();
