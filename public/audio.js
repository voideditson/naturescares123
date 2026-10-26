// Tiny synthesized sound effects. No audio files needed.
let ac = null, muted = false, noiseBuf = null;

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function unlock() { ctx(); }
export function toggleMute() { muted = !muted; return muted; }

function tone(f0, f1, dur, type = 'sine', vol = 0.12) {
  const a = ctx(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}

function noise(dur, vol, lp) {
  const a = ctx(); if (!a || muted) return;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = lp;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(0, Math.random()); s.stop(a.currentTime + dur);
}

export const sfx = {
  jump: () => tone(300, 620, 0.12, 'square', 0.05),
  land: (v) => noise(0.12, Math.min(0.25, v / 80), 700),
  pad: () => tone(260, 1100, 0.3, 'sawtooth', 0.07),
  hit: () => { tone(180, 60, 0.2, 'sawtooth', 0.15); noise(0.15, 0.12, 1500); },
  boom: (near) => { noise(0.7, 0.3 * near, 500); tone(90, 30, 0.5, 'sine', 0.3 * near); },
  thunder: (near) => noise(1.4, 0.35 * near, 300),
  start: () => { tone(220, 220, 0.18, 'square', 0.08); setTimeout(() => tone(330, 330, 0.18, 'square', 0.08), 170); setTimeout(() => tone(440, 440, 0.3, 'square', 0.1), 340); },
  tick: () => tone(700, 700, 0.06, 'square', 0.04),
  die: () => tone(300, 60, 0.6, 'sawtooth', 0.15),
};
