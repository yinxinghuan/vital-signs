// Web Audio synthesis for the heartbeat rhythm.
// - thump(): on every player tap (lub-dub double thump)
// - tick(): the metronome target beat (very subtle)
// - flatline(): sustained ER tone
// - vfib(): chaotic noise
// - stopSustained(): cuts the flatline/vfib tone

let ctx: AudioContext | null = null;
let sustainedNodes: { osc?: OscillatorNode; gain?: GainNode; noise?: AudioBufferSourceNode } | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function unlockAudio() {
  const ac = ensureCtx();
  if (ac && ac.state === 'suspended') ac.resume();
}

function envelope(gain: GainNode, peak: number, attack: number, decay: number, now: number) {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}

// "lub-dub" double thump on tap
export function thump(strength: number = 1) {
  const ac = ensureCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const peakA = 0.55 * strength;
  const peakB = 0.35 * strength;

  // Low thud — two-component to feel chest-deep
  const make = (freqHz: number, delay: number, peak: number) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, now + delay);
    osc.frequency.exponentialRampToValueAtTime(freqHz * 0.55, now + delay + 0.18);
    const g = ac.createGain();
    envelope(g, peak, 0.005, 0.18, now + delay);
    osc.connect(g).connect(ac.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.22);
  };
  make(110, 0, peakA);
  make(85, 0.14, peakB);
}

// soft target metronome tick (a near-inaudible whisper to give the player a hint)
export function tick(volume: number = 0.12) {
  const ac = ensureCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, now);
  const g = ac.createGain();
  envelope(g, volume, 0.003, 0.035, now);
  // High-pass via a biquad to thin it
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  osc.connect(hp).connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}

// ECG monitor bleep (the regular healthy ping)
export function bleep(pitch: number = 880, volume: number = 0.18) {
  const ac = ensureCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = pitch;
  const g = ac.createGain();
  envelope(g, volume, 0.002, 0.07, now);
  osc.connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

export function flatline() {
  stopSustained();
  const ac = ensureCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 660;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  sustainedNodes = { osc, gain };
}

export function vfib() {
  stopSustained();
  const ac = ensureCtx();
  if (!ac) return;
  const now = ac.currentTime;
  // chaotic noise burst that loops
  const bufSize = ac.sampleRate * 1.0;
  const buffer = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    const env = Math.sin((i / bufSize) * Math.PI * 8) * 0.5 + 0.5;
    data[i] = (Math.random() * 2 - 1) * env * 0.6;
  }
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.1);
  noise.connect(bp).connect(gain).connect(ac.destination);
  noise.start(now);
  sustainedNodes = { noise, gain };
}

export function stopSustained() {
  const ac = ensureCtx();
  if (!ac || !sustainedNodes) return;
  const now = ac.currentTime;
  const { osc, gain, noise } = sustainedNodes;
  if (gain) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  }
  setTimeout(() => {
    try { osc?.stop(); } catch {}
    try { noise?.stop(); } catch {}
  }, 350);
  sustainedNodes = null;
}
