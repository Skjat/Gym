import { useEffect, useRef, useState } from 'react';
import { dictationSupported, startDictation, stopDictation } from '../lib/dictation';
import { Icon } from './Icon';
import { toast } from './ui';

/**
 * Dictation toggle: recognised speech is appended to `value` (live, including interim results).
 * Where speech recognition is unavailable it focuses the field so the keyboard's mic can be used.
 */
export function MicButton({
  value,
  onChange,
  focusTarget,
  className = 'icon-btn mic',
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  focusTarget?: () => HTMLElement | null | undefined;
  className?: string;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const base = useRef('');
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => () => stopDictation(), []);

  const toggle = () => {
    if (listening) {
      stopDictation();
      return;
    }
    if (!dictationSupported()) {
      toast('Здесь нет встроенного распознавания речи — нажмите 🎤 на клавиатуре iPhone.');
      focusTarget?.()?.focus();
      return;
    }
    base.current = value.trim();
    setListening(true);
    startDictation({
      onText: (t) => latest.current(base.current ? `${base.current} ${t}` : t),
      onEnd: () => setListening(false),
      onError: (m) => toast(m),
    });
  };

  return (
    <button
      type="button"
      className={`${className} ${listening ? 'listening' : ''}`}
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? 'Остановить диктовку' : 'Надиктовать'}
    >
      <Icon name={listening ? 'stop' : 'mic'} />
    </button>
  );
}
