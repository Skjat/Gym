import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { WorkoutMeta } from '../components/WorkoutView';
import { newConversation } from '../coach/claude';
import { sendToCoach, stopCoach, useCoachRuntime } from '../coach/runtime';
import { MicButton } from '../components/MicButton';
import { stopDictation } from '../lib/dictation';
import { chatForToday, QUICK_PROMPTS } from '../coach/flows';
import { findWorkout } from '../coach/tools';
import { startWorkout } from '../lib/player';
import { humanDateTime, todayISO } from '../lib/format';
import { uid } from '../lib/id';
import { MAX_IMAGES, prepareImage, type PreparedImage } from '../lib/images';
import { itemName } from '../data/library';

const NO_IMAGES: PreparedImage[] = [];

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
  const prefillState = (loc.state as { prefill?: string } | null)?.prefill;
  const conversations = useStore((s) => s.conversations);
  const apiKey = useStore((s) => s.settings.apiKey);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const conv = conversations.find((c) => c.id === id);
  const convId = conv?.id ?? '';
  // Draft, pending screenshots and the in-flight answer survive switching tabs.
  const text = useStore((s) => s.drafts[convId] ?? '');
  const setDraft = useStore((s) => s.setDraft);
  const setText = (v: string) => convId && setDraft(convId, v);
  const turn = useCoachRuntime((s) => s.turns[convId]);
  const attachments = useCoachRuntime((s) => s.attachments[convId] ?? NO_IMAGES);
  const setRuntimeAttachments = useCoachRuntime((s) => s.setAttachments);
  const setAttachments = (fn: (a: PreparedImage[]) => PreparedImage[]) =>
    convId && setRuntimeAttachments(convId, fn(useCoachRuntime.getState().attachments[convId] ?? []));
  const busy = !!turn;
  const streamText = turn?.stream ?? '';
  const status = turn?.status ?? '';
  const [listOpen, setListOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  // /coach without id → today's conversation
  useEffect(() => {
    if (!id) nav(`/coach/${chatForToday().id}`, { replace: true });
  }, [id, nav]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conv?.display.length, streamText, busy]);

  // grow the input with its content (also for a restored draft or dictated text)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    try {
      const list = Array.from(files).slice(0, MAX_IMAGES - attachments.length);
      const prepared = await Promise.all(list.map((f) => prepareImage(f)));
      setAttachments((a) => [...a, ...prepared].slice(0, MAX_IMAGES));
      if (files.length > list.length) toast(`Можно приложить до ${MAX_IMAGES} картинок`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async (raw: string) => {
    const images = attachments;
    const q = raw.trim() || (images.length ? 'Посмотри скриншоты тренировки из Garmin и разбери её.' : '');
    if (!conv || !q || busy) return;
    if (!apiKey) {
      toast('Сначала добавьте API-ключ Claude в профиле');
      return;
    }
    stopDictation();
    setAttachments(() => []);
    setDraft(conv.id, '');
    await sendToCoach(conv.id, q, images);
  };

  useEffect(() => {
    if (prefillState) {
      setText(prefillState);
      nav(loc.pathname, { replace: true, state: {} });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillState]);

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
              Напиши, какую тренировку хочешь сегодня: сколько есть времени, где ты, какой инвентарь и как самочувствие. Я соберу тренировку, учту твою историю и данные Garmin, а после — разберу результат и поправлю план. Можно прислать скриншоты тренировки из Garmin Connect — кнопка 📎.
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
          if (d.role === 'user')
            return (
              <div key={d.id} className="bubble user">
                {!!d.images?.length && (
                  <div className="bubble-images">
                    {d.images.map((src, i) => <img key={i} src={src} alt="" />)}
                  </div>
                )}
                {d.text}
              </div>
            );
          if (d.role === 'error') return <div key={d.id} className="bubble error">{d.text}</div>;
          if (d.role === 'event')
            return d.workoutId ? (
              <WorkoutCardInline key={d.id} id={d.workoutId} />
            ) : d.link ? (
              <Link key={d.id} to={d.link} className="chat-event">✓ {d.text} →</Link>
            ) : (
              <div key={d.id} className="chat-event">✓ {d.text}</div>
            );
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
            <button className="btn ghost small" onClick={() => stopCoach(convId)}>Стоп</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
      {(attachments.length > 0 || preparing) && (
        <div className="attach-row">
          {attachments.map((a, i) => (
            <div key={i} className="attach-thumb">
              <img src={a.thumb} alt="" />
              <button onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))} aria-label="Убрать">×</button>
            </div>
          ))}
          {preparing && <span className="faint small">Готовлю…</span>}
        </div>
      )}
      <div className="chat-input">
        <button className="icon-btn attach" onClick={() => fileRef.current?.click()} disabled={busy || attachments.length >= MAX_IMAGES} aria-label="Приложить скриншоты">
          <Icon name="clip" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={attachments.length ? 'Комментарий к скриншотам…' : 'Напиши тренеру…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <MicButton value={text} onChange={setText} focusTarget={() => inputRef.current} disabled={!conv} />
        <button className="send" disabled={(!text.trim() && !attachments.length) || busy || preparing} onClick={() => send(text)} aria-label="Отправить">
          <Icon name="send" />
        </button>
      </div>
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
