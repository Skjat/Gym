let enabled = true;
let voice: SpeechSynthesisVoice | undefined;

export function configureSpeech(on: boolean, voiceName?: string) {
  enabled = on;
  if (typeof speechSynthesis === 'undefined') return;
  const pick = () => {
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'));
    voice = voices.find((v) => v.name === voiceName) ?? voices.find((v) => /milena|yuri|premium|enhanced/i.test(v.name)) ?? voices[0];
  };
  pick();
  speechSynthesis.onvoiceschanged = pick;
}

export function russianVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'));
}

export function speak(text: string, opts: { interrupt?: boolean } = {}) {
  if (!enabled || typeof speechSynthesis === 'undefined' || !text) return;
  if (opts.interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
  u.lang = 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

/** iOS only allows speech after a user gesture — call this from a tap handler once. */
export function unlockSpeech() {
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

let audioCtx: AudioContext | undefined;
export function beep(freq = 880, ms = 150) {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number | number[] = 200) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
