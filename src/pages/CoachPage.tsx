import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { WorkoutMeta } from '../components/WorkoutView';
import { friendlyError, newConversation, runCoachTurn } from '../coach/claude';
import { chatForToday, QUICK_PROMPTS } from '../coach/flows';
import { findWorkout } from '../coach/tools';
import { startWorkout } from '../lib/player';
import { humanDateTime, todayISO } from '../lib/format';
import { uid } from '../lib/id';
import { itemName } from '../data/library';

function WorkoutCardInline({ id }: { id: string }) {
  const nav = useNavigate();
  const w = findWorkout(id);
  const upsertPlanDays = useStore((s) => s.upsertPlanDays);
  if (!w) return <div className="chat-event">Тренировка удалена</div>;
  const names = w.blocks.flatMap((b) => b.items.map((i) => itemName(i)));
  return (
    <div className="wo-card">
      <div className="faint small">Тренировка от тренера</div>
      <h3 style={{ margin: '2px 0 6px' }}>{w.title}</h3>
      <WorkoutMeta w={w} />
      {w.summary && <div className="muted small mt">{w.summary}</div>}
      <div className="faint small mt">
        {names.slice(0, 7).join(' · ')}
        {names.length > 7 ? ` и ещё ${names.length - 7}` : ''}
      </div>
      <div className="btn-row mt">
        <button className="btn primary small" onClick={() => startWorkout(w) && nav('/player')}>
          <Icon name="play" fill size={16} /> Начать
        </button>
        <Link className="btn small" to={`/workout/${w.id}`}>
          Открыть
        </Link>
        <button
          className="btn small"
          onClick={() => {
            upsertPlanDays([{ id: uid('pd'), date: todayISO(), title: w.title, discipline: w.discipline, intensity: w.intensity, description: w.summary, workoutId: w.id, status: 'planned' }]);
            toast('Добавлено в план на сегодня');
          }}
        >
          В план
        </button>
      </div>
    </div>
  );
}

export default function CoachPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const autoSendState = (loc.state as { autoSend?: string } | null)?.autoSend;
  const conversations = useStore((s) => s.conversations);
  const apiKey = useStore((s) => s.settings.apiKey);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const conv = conversations.find((c) => c.id === id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  // /coach without id → today's conversation
  useEffect(() => {
    if (!id) nav(`/coach/${chatForToday().id}`, { replace: true });
  }, [id, nav]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conv?.display.length, streamText, busy]);

  const send = async (q: string) => {
    if (!conv || !q.trim() || busy) return;
    if (!apiKey) {
      toast('Сначала добавьте API-ключ Claude в профиле');
      return;
    }
    setText('');
    setBusy(true);
    setStreamText('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await runCoachTurn(conv.id, q.trim(), { onText: setStreamText, onStatus: setStatus, signal: ac.signal });
    } catch (e) {
      const msg = friendlyError(e);
      useStore.getState().patchConversation(conv.id, (c) => ({
        ...c,
        display: [...c.display, { id: uid('d'), role: 'error', text: msg, at: new Date().toISOString() }],
      }));
    } finally {
      setBusy(false);
      setStreamText('');
      setStatus('');
      abortRef.current = null;
    }
  };

  useEffect(() => {
    const q = autoSendState;
    if (conv && q && !autoSent.current) {
      autoSent.current = true;
      nav(loc.pathname, { replace: true, state: {} });
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id]);

  if (!conv) return <Page title="Тренер">{null}</Page>;

  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Page
      title="Тренер"
      sub={conv.title}
      actions={
        <>
          <button className="icon-btn" onClick={() => setListOpen(true)} aria-label="Диалоги">
            <Icon name="history" />
          </button>
          <button className="icon-btn" onClick={() => nav(`/coach/${newConversation('chat').id}`)} aria-label="Новый диалог">
            <Icon name="plus" />
          </button>
        </>
      }
    >
      <div className="chat">
        {conv.display.length === 0 && !busy && (
          <div className="card">
            <h3>Привет! Я твой тренер 👋</h3>
            <div className="muted small">
              Напиши, какую тренировку хочешь сегодня: сколько есть времени, где ты, какой инвентарь и как самочувствие. Я соберу тренировку, учту твою историю и данные Garmin, а после — разберу результат и поправлю план.
            </div>
            <div className="chips mt" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
              {QUICK_PROMPTS.map((q) => (
                <button key={q} className="chip outline" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {conv.display.map((d) => {
          if (d.role === 'user') return <div key={d.id} className="bubble user">{d.text}</div>;
          if (d.role === 'error') return <div key={d.id} className="bubble error">{d.text}</div>;
          if (d.role === 'event')
            return d.workoutId ? <WorkoutCardInline key={d.id} id={d.workoutId} /> : <div key={d.id} className="chat-event">✓ {d.text}</div>;
          return (
            <div key={d.id} className="bubble assistant">
              <Markdown text={d.text} />
            </div>
          );
        })}
        {busy && streamText && (
          <div className="bubble assistant">
            <Markdown text={streamText} />
          </div>
        )}
        {busy && (
          <div className="row" style={{ alignSelf: 'flex-start', gap: 8 }}>
            <span className="typing"><i /><i /><i /></span>
            <span className="faint small">{status}</span>
            <button className="btn ghost small" onClick={() => abortRef.current?.abort()}>Стоп</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input">
        <textarea
          rows={1}
          value={text}
          placeholder="Напиши тренеру…"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button className="send" disabled={!text.trim() || busy} onClick={() => send(text)} aria-label="Отправить">
          <Icon name="send" />
        </button>
      </div>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Диалоги">
        <div className="list">
          {sorted.map((c) => (
            <div key={c.id} className="list-item" onClick={() => { setListOpen(false); nav(`/coach/${c.id}`); }}>
              <div className="grow">
                <div className="title ellipsis">{c.kind === 'analysis' ? '📊 ' : ''}{c.title}</div>
                <div className="meta">{humanDateTime(c.updatedAt)} · {c.display.filter((d) => d.role === 'user').length} сообщ.</div>
              </div>
              {c.id !== conv.id && (
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Удалить диалог?')) deleteConversation(c.id);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="btn block primary" onClick={() => { setListOpen(false); nav(`/coach/${newConversation('chat').id}`); }}>
          Новый диалог
        </button>
      </Sheet>
    </Page>
  );
}
