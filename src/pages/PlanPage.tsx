import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Seg, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { addDays, humanDate, todayISO, weekStart, weekdayLong } from '../lib/format';
import { INTENSITIES, disciplineIcon, DISCIPLINES } from '../data/taxonomy';
import { findWorkout } from '../coach/tools';
import { startWorkout } from '../lib/player';
import { chatForToday } from '../coach/flows';
import { uid } from '../lib/id';
import type { Intensity, PlanDay } from '../types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const COLORS: Record<string, string> = { easy: 'green', moderate: 'yellow', hard: 'red', rest: '' };

export default function PlanPage() {
  const nav = useNavigate();
  const plan = useStore((s) => s.plan);
  const saved = useStore((s) => s.savedWorkouts);
  const updatePlanDay = useStore((s) => s.updatePlanDay);
  const upsertPlanDays = useStore((s) => s.upsertPlanDays);
  const removePlanDays = useStore((s) => s.removePlanDays);
  const [offset, setOffset] = useState(0);
  const [edit, setEdit] = useState<PlanDay | null>(null);
  const start = addDays(weekStart(todayISO()), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const ask = (q: string) => nav(`/coach/${chatForToday().id}`, { state: { autoSend: q } });

  return (
    <Page back title="План" sub={plan.goal ? `Цель: ${plan.goal}` : 'Тренировки по дням'}>
      <div className="btn-row mb">
        <button className="btn small" onClick={() => setOffset(offset - 1)}>←</button>
        <button className="btn small" style={{ flex: 3 }} onClick={() => setOffset(0)}>
          {humanDate(start)} — {humanDate(addDays(start, 6))}
        </button>
        <button className="btn small" onClick={() => setOffset(offset + 1)}>→</button>
      </div>
      {plan.notes && <div className="card small muted">{plan.notes}</div>}

      {days.map((date) => {
        const d = plan.days.find((x) => x.date === date);
        const w = findWorkout(d?.workoutId);
        const isToday = date === todayISO();
        return (
          <div key={date} className="card" style={isToday ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined}>
            <div className="row between">
              <div className="faint small">{cap(weekdayLong(date))}, {humanDate(date)}{isToday ? ' · сегодня' : ''}</div>
              <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setEdit(d ?? { id: uid('pd'), date, title: '', status: 'planned', intensity: 'moderate' })}>
                <Icon name={d ? 'edit' : 'plus'} size={16} />
              </button>
            </div>
            {d ? (
              <>
                <div className="row mt" style={{ gap: 8 }}>
                  <h3 style={{ margin: 0 }} className="grow">{disciplineIcon(d.discipline)} {d.title}</h3>
                  {d.intensity && <span className={`tag ${COLORS[d.intensity]}`}>{INTENSITIES[d.intensity]}</span>}
                </div>
                {d.description && <div className="muted small mt">{d.description}</div>}
                <div className="row wrap mt" style={{ gap: 6 }}>
                  {d.status === 'done' && <span className="tag green">✓ выполнено</span>}
                  {d.status === 'skipped' && <span className="tag">пропущено</span>}
                  {d.sessionId && <Link className="tag blue" to={`/session/${d.sessionId}`}>отчёт →</Link>}
                </div>
                {d.status === 'planned' && d.intensity !== 'rest' && (
                  <div className="btn-row mt">
                    {w ? (
                      <button className="btn primary small" onClick={() => startWorkout(w, d.id) && nav('/player')}><Icon name="play" fill size={16} /> Начать</button>
                    ) : (
                      <button className="btn primary small" onClick={() => ask(`Собери тренировку на ${date} по плану: «${d.title}». ${d.description ?? ''}`)}><Icon name="sparkle" size={16} /> Собрать</button>
                    )}
                    {w && <Link className="btn small" to={`/workout/${w.id}`}>Открыть</Link>}
                    <button className="btn small" onClick={() => updatePlanDay(d.id, { status: 'done' })}>✓</button>
                    <button className="btn small" onClick={() => updatePlanDay(d.id, { status: 'skipped' })}>Пропуск</button>
                  </div>
                )}
              </>
            ) : (
              <div className="faint small mt">—</div>
            )}
          </div>
        );
      })}

      <div className="btn-row">
        <button className="btn primary" onClick={() => ask('Составь или обнови мой план тренировок на ближайшие 2 недели с учётом целей, истории и восстановления.')}>
          <Icon name="sparkle" size={18} /> План с тренером
        </button>
        <button className="btn" onClick={() => ask('Посмотри, как я выполнял план на этой неделе и как восстанавливаюсь, и скорректируй план на следующие дни.')}>Скорректировать</button>
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `${cap(weekdayLong(edit.date))}, ${humanDate(edit.date)}` : ''}>
        {edit && (
          <>
            <label className="field"><span>Название</span><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Например: Лёгкий бег 40 мин" /></label>
            <div className="field"><span>Интенсивность</span>
              <Seg options={(['easy', 'moderate', 'hard', 'rest'] as const).map((k) => ({ id: k, label: INTENSITIES[k] }))} value={(edit.intensity ?? 'moderate') as Intensity | 'rest'} onChange={(v) => setEdit({ ...edit, intensity: v })} />
            </div>
            <label className="field"><span>Направление</span>
              <select className="select" value={edit.discipline ?? ''} onChange={(e) => setEdit({ ...edit, discipline: e.target.value || undefined })}>
                <option value="">—</option>
                {DISCIPLINES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Тренировка</span>
              <select className="select" value={edit.workoutId ?? ''} onChange={(e) => setEdit({ ...edit, workoutId: e.target.value || undefined })}>
                <option value="">— без привязки —</option>
                {saved.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              </select>
            </label>
            <label className="field"><span>Описание</span><textarea className="textarea" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <button className="btn primary block" disabled={!edit.title.trim()} onClick={() => { upsertPlanDays([edit]); setEdit(null); toast('Сохранено'); }}>Сохранить</button>
            {plan.days.some((x) => x.date === edit.date) && (
              <button className="btn danger block mt" onClick={() => { removePlanDays([edit.date]); setEdit(null); }}>Удалить день</button>
            )}
          </>
        )}
      </Sheet>
    </Page>
  );
}
