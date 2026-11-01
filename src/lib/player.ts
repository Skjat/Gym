import type { WorkoutTemplate } from '../types';
import { useStore, type ActiveWorkout } from '../store/store';
import { flattenWorkout } from './workoutFlow';
import { uid } from './id';

/** Creates the active workout state. Returns false if the user kept the current one. */
export function startWorkout(template: WorkoutTemplate, planDayId?: string): boolean {
  const store = useStore.getState();
  if (store.active && !confirm('Уже идёт другая тренировка. Завершить её без сохранения и начать новую?')) return false;
  const steps = flattenWorkout(template);
  if (!steps.length) {
    alert('В тренировке нет упражнений.');
    return false;
  }
  const now = Date.now();
  const active: ActiveWorkout = {
    session: {
      id: uid('s'),
      title: template.title,
      discipline: template.discipline,
      template,
      startedAt: new Date(now).toISOString(),
      sets: [],
      hr: [],
      tips: [],
      planDayId,
    },
    steps,
    index: 0,
    phase: 'ready',
    phaseStart: now,
    restSec: 0,
    t0: now,
  };
  store.setActive(active);
  return true;
}
