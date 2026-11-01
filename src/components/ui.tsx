import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

export function Page({ title, sub, back, actions, children }: { title?: ReactNode; sub?: ReactNode; back?: boolean | string; actions?: ReactNode; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="page">
      {(back || actions) && (
        <div className="topbar">
          {back ? (
            <button className="back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
              <Icon name="back" /> Назад
            </button>
          ) : (
            <span />
          )}
          <div className="row">{actions}</div>
        </div>
      )}
      {title && (
        <div className="page-head">
          <div className="grow">
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSetter?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast">{msg}</div> : null;
}

export function Chips<T extends string>({ options, value, onChange, allLabel }: { options: { id: T; label: string; icon?: string }[]; value: T | ''; onChange: (v: T | '') => void; allLabel?: string }) {
  return (
    <div className="chips">
      {allLabel && (
        <button className={`chip ${value === '' ? 'on' : ''}`} onClick={() => onChange('')}>
          {allLabel}
        </button>
      )}
      {options.map((o) => (
        <button key={o.id} className={`chip ${value === o.id ? 'on' : ''}`} onClick={() => onChange(value === o.id && allLabel ? '' : o.id)}>
          {o.icon ? `${o.icon} ` : ''}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, suffix }: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; suffix?: string }) {
  const v = value ?? 0;
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, Math.round((v - step) * 100) / 100))}>−</button>
      <input
        inputMode="decimal"
        value={value ?? ''}
        placeholder="0"
        onChange={(e) => {
          const n = parseFloat(e.target.value.replace(',', '.'));
          onChange(isNaN(n) ? undefined : n);
        }}
      />
      <button onClick={() => onChange(Math.round((v + step) * 100) / 100)}>+</button>
      {suffix && <span className="faint">{suffix}</span>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="big">{icon}</div>}
      <div style={{ fontWeight: 600, color: 'var(--text2)' }}>{title}</div>
      {children && <div className="mt">{children}</div>}
    </div>
  );
}

export function OriginTag({ origin }: { origin: 'builtin' | 'edited' | 'custom' | 'fedb' }) {
  if (origin === 'custom') return <span className="tag accent">✨ от тренера</span>;
  if (origin === 'edited') return <span className="tag blue">✎ изменено тренером</span>;
  return null;
}

export function Stat({ v, l }: { v: ReactNode; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v ?? '—'}</div>
      <div className="l">{l}</div>
    </div>
  );
}
