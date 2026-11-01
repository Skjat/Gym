import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getProgram } from '../data/library';
import { Page, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { WorkoutMeta, WorkoutView } from '../components/WorkoutView';
import { QUALITIES, tagLabel, disciplineIcon } from '../data/taxonomy';
import { startWorkout } from '../lib/player';
import { useStore } from '../store/store';
import { addDays, todayISO, weekdayShort, humanDate } from '../lib/format';
import { uid } from '../lib/id';
import { chatForToday } from '../coach/flows';
import type { WorkoutTemplate } from '../types';

export default function ProgramDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const p = getProgram(id);
  const upsertPlanDays = useStore((s) => s.upsertPlanDays);
  const [open, setOpen] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<WorkoutTemplate | null>(null);
  if (!p) return <Page back title="Не найдено">{null}</Page>;

  const addToPlan = (w: WorkoutTemplate, date: string) => {
    upsertPlanDays([{ id: uid('pd'), date, title: w.title === 'Тренировка A' || /^Тренировка/.test(w.title) ? `${p.title}: ${w.title}` : w.title, discipline: p.discipline, intensity: w.intensity, description: w.focus, workoutId: w.id, status: 'planned' }]);
    setPlanFor(null);
    toast(`Добавлено в план: ${humanDate(date)}`);
  };

  const adapt = () => {
    const conv = chatForToday();
    nav(`/coach/${conv.id}`, {
      state: { autoSend: `Хочу заниматься по программе «${p.title}» (id ${p.id}). Адаптируй её под мои цели, уровень и восстановление и распиши в плане на ближайшие 2 недели.` },
    });
  };

  return (
    <Page back title={p.title} sub={p.subtitle}>
      <div className="card">
        <div className="tags mb">
          <span className="tag accent">{disciplineIcon(p.discipline)} {tagLabel('discipline', p.discipline)}</span>
          <span className="tag">{tagLabel('difficulty', p.level)}</span>
          {p.locations.map((l) => <span key={l} className="tag">{tagLabel('location', l)}</span>)}
          {p.weeks && <span className="tag">{p.weeks} нед</span>}
          {p.sessionsPerWeek && <span className="tag">{p.sessionsPerWeek}×/нед</span>}
        </div>
        {p.goal && <p style={{ margin: '0 0 8px' }}><b>Цель:</b> {p.goal}</p>}
        {p.description && <p className="muted" style={{ margin: '0 0 8px' }}>{p.description}</p>}
        {p.schedule && <p style={{ margin: '0 0 8px' }}><b>Расписание:</b> {p.schedule}</p>}
        {p.progression && <p style={{ margin: 0 }}><b>Прогрессия:</b> {p.progression}</p>}
        {!!p.qualities?.length && (
          <div className="tags mt">
            {p.qualities.map((q) => <span key={q} className="tag blue">{QUALITIES.find((x) => x.id === q)?.icon} {tagLabel('quality', q)}</span>)}
          </div>
        )}
        {!!p.equipment?.length && <div className="faint small mt">Инвентарь: {p.equipment.map((e) => tagLabel('equipment', e)).join(', ')}</div>}
        <button className="btn block mt" onClick={adapt}>
          <Icon name="sparkle" size={18} /> Адаптировать с тренером
        </button>
      </div>

      <div className="section-title"><span>Тренировки</span></div>
      {p.workouts.map((w) => (
        <div key={w.id} className="card">
          <div className="row between" onClick={() => setOpen(open === w.id ? null : w.id)} style={{ cursor: 'pointer' }}>
            <div className="grow">
              <h3>{w.title}</h3>
              {w.focus && <div className="faint">{w.focus}</div>}
            </div>
            <Icon name={open === w.id ? 'close' : 'chevron'} size={18} />
          </div>
          <div className="mt"><WorkoutMeta w={w} /></div>
          {w.notes && <div className="muted small mt">{w.notes}</div>}
          {open === w.id && <WorkoutView w={w} />}
          <div className="btn-row mt">
            <button className="btn primary" onClick={() => startWorkout(w) && nav('/player')}>
              <Icon name="play" fill size={18} /> Начать
            </button>
            <button className="btn" onClick={() => setPlanFor(w)}>В план</button>
          </div>
        </div>
      ))}

      <Sheet open={!!planFor} onClose={() => setPlanFor(null)} title="На какой день?">
        <div className="list">
          {Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)).map((d) => (
            <div key={d} className="list-item" onClick={() => planFor && addToPlan(planFor, d)}>
              <div className="grow">{weekdayShort(d)}, {humanDate(d)}{d === todayISO() ? ' — сегодня' : ''}</div>
            </div>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
