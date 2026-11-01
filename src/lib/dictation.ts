// Voice input via the browser's speech recognition (Safari: webkitSpeechRecognition).
/* eslint-disable @typescript-eslint/no-explicit-any */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function ctor(): (new () => Recognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function dictationSupported(): boolean {
  return !!ctor();
}

let current: Recognition | null = null;

export interface DictationHandlers {
  /** full text recognised in this session so far (interim results included) */
  onText: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export function startDictation(h: DictationHandlers): void {
  const Rec = ctor();
  if (!Rec) {
    h.onError('Голосовой ввод здесь недоступен — нажмите микрофон на клавиатуре iPhone.');
    h.onEnd();
    return;
  }
  stopDictation();
  const rec = new Rec();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e: any) => {
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? '');
    h.onText(parts.join(' ').replace(/\s+/g, ' ').trim());
  };
  rec.onerror = (e: any) => {
    const code = e?.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      h.onError('Нет доступа к микрофону. Разрешите микрофон и распознавание речи для Safari в настройках iPhone.');
    } else if (code === 'no-speech') {
      h.onError('Ничего не услышал — попробуйте ещё раз.');
    } else if (code !== 'aborted') {
      h.onError(`Ошибка распознавания речи${code ? `: ${code}` : ''}`);
    }
  };
  rec.onend = () => {
    if (current === rec) current = null;
    h.onEnd();
  };
  current = rec;
  try {
    rec.start();
  } catch {
    current = null;
    h.onError('Не удалось включить микрофон.');
    h.onEnd();
  }
}

export function stopDictation(): void {
  const rec = current;
  current = null;
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
}
