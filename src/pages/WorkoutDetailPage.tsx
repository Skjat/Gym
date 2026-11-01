import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { WorkoutMeta, WorkoutView } from '../components/WorkoutView';
import { findWorkout } from '../coach/tools';
import { findProgramWorkout } from '../data/library';
import { startWorkout } from '../lib/player';
import { useStore } from '../store/store';
import { addDays, humanDate, todayISO, weekdayShort } from '../lib/format';
import { uid } from '../lib/id';
import { chatForToday } from '../coach/flows';

export default function WorkoutDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  useStore((s) => s.customPrograms); // re-render after edits
  useStore((s) => s.savedWorkouts);
  const w = findWorkout(id);
  const deleteWorkout = useStore((s) => s.deleteWorkout);
  const upsertPlanDays = useStore((s) => s.upsertPlanDays);
  const [planOpen, setPlanOpen] = useState(false);
  if (!w) return <Page back title="Тренировка не найдена">{null}</Page>;
  const program = findProgramWorkout(w.id)?.program;
  const isSaved = useStore.getState().savedWorkouts.some((x) => x.id === w.id);

  return (
    <Page back title={w.title} sub={program ? `Программа «${program.title}»` : w.createdBy === 'coach' ? 'Составлена тренером' : undefined}>
      <div className="card">
        <WorkoutMeta w={w} />
        {(w.summary || w.focus) && <p className="muted" style={{ marginBottom: 0 }}>{w.summary ?? w.focus}</p>}
        {w.notes && <p className="small muted">{w.notes}</p>}
        <div className="btn-row mt">
          <button className="btn primary big" onClick={() => startWorkout(w) && nav('/player')}>
            <Icon name="play" fill /> Начать
          </button>
        </div>
        <div className="btn-row mt">
          <button className="btn small" onClick={() => setPlanOpen(true)}>В план</button>
          <button
            className="btn small"
            onClick={() =>
              nav(`/coach/${chatForToday().id}`, {
                state: { autoSend: `Адаптируй тренировку «${w.title}» (workoutId ${w.id}) под меня на сегодня: ` },
              })
            }
          >
            <Icon name="sparkle" size={16} /> Адаптировать
          </button>
          <button className="btn small" onClick={() => nav(`/coach/${chatForToday().id}`, { state: { prefill: `Измени тренировку «${w.title}» (workoutId ${w.id}): ` } })}>
            <Icon name="edit" size={16} /> Изменить
          </button>
          {isSaved && (
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm('Удалить тренировку?')) {
                  deleteWorkout(w.id);
                  nav(-1);
                }
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
      <WorkoutView w={w} />
      <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title="На какой день?">
        <div className="list">
          {Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)).map((d) => (
            <div
              key={d}
              className="list-item"
              onClick={() => {
                upsertPlanDays([{ id: uid('pd'), date: d, title: w.title, discipline: w.discipline, intensity: w.intensity, description: w.summary ?? w.focus, workoutId: w.id, status: 'planned' }]);
                setPlanOpen(false);
                toast(`Добавлено в план: ${humanDate(d)}`);
              }}
            >
              <div className="grow">{weekdayShort(d)}, {humanDate(d)}{d === todayISO() ? ' — сегодня' : ''}</div>
            </div>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
