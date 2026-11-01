import type Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../store/store';
import type { BlockKind, Exercise, Intensity, PlanDay, WorkoutBlock, WorkoutItem, WorkoutTemplate } from '../types';
import { allExercises, filterExercises, getExercise, findProgramWorkout } from '../data/library';
import { DISCIPLINES } from '../data/taxonomy';
import { uid } from '../lib/id';
import { addDays, todayISO } from '../lib/format';
import { activityLine, dailyLine, sessionLine } from './context';
import { estimateMinutes } from '../lib/workoutFlow';

type Tool = Anthropic.Beta.BetaTool;

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    exerciseId: { type: 'string', description: 'id из каталога; пусто для своего упражнения' },
    name: { type: 'string', description: 'название (обязательно для своего упражнения)' },
    description: { type: 'string', description: 'техника — только для своего упражнения' },
    sets: int,
    reps: { type: 'string', description: 'например "10", "8-12", "макс"' },
    durationSec: int,
    distanceM: int,
    restSec: { type: 'integer', description: 'отдых после каждого подхода, сек' },
    load: { type: 'string', description: 'нагрузка: "60 кг", "RPE 7", "70% 1ПМ", "лёгкие гантели"' },
    tempo: str,
    side: { type: 'string', enum: ['each'], description: '"each" — выполнять на каждую сторону' },
    hrZone: { type: 'integer', description: 'целевая зона пульса 1–5' },
    notes: str,
  },
};

export const COACH_TOOLS: Tool[] = [
  {
    name: 'create_workout',
    description:
      'Сохраняет тренировку в приложении и показывает её пользователю карточкой с кнопкой «Начать». Вызывай всякий раз, когда составляешь или меняешь тренировку. Возвращает workoutId.',
    input_schema: {
      type: 'object',
      properties: {
        title: str,
        summary: { type: 'string', description: '1–2 предложения: цель и логика тренировки' },
        discipline: { type: 'string', enum: DISCIPLINES.map((d) => d.id) },
        location: { type: 'string', enum: ['gym', 'home', 'outdoor'] },
        estimatedMinutes: int,
        intensity: { type: 'string', enum: ['easy', 'moderate', 'hard'] },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: str,
              kind: { type: 'string', enum: ['warmup', 'main', 'circuit', 'interval', 'cooldown'] },
              rounds: { type: 'integer', description: 'кругов (для circuit/interval)' },
              restBetweenRoundsSec: int,
              items: { type: 'array', items: ITEM_SCHEMA },
            },
            required: ['title', 'kind', 'items'],
          },
        },
        planDate: { type: 'string', description: 'ГГГГ-ММ-ДД — поставить тренировку в план на эту дату (необязательно)' },
      },
      required: ['title', 'blocks'],
    },
  },
  {
    name: 'get_training_plan',
    description: 'Возвращает план тренировок за период (по умолчанию: прошлая неделя и 3 недели вперёд).',
    input_schema: { type: 'object', properties: { from: str, to: str } },
  },
  {
    name: 'update_training_plan',
    description:
      'Добавляет или изменяет дни плана (по дате) и/или удаляет дни. Для дня отдыха укажи intensity "rest". workoutId — id тренировки из create_workout или программы.',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'цель плана (необязательно)' },
        notes: { type: 'string', description: 'общие заметки к плану (необязательно)' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
              title: str,
              discipline: str,
              intensity: { type: 'string', enum: ['easy', 'moderate', 'hard', 'rest'] },
              description: str,
              workoutId: str,
            },
            required: ['date', 'title'],
          },
        },
        removeDates: { type: 'array', items: str },
      },
    },
  },
  {
    name: 'get_recent_sessions',
    description: 'Список тренировок, выполненных в приложении, за последние N дней (по умолчанию 21): длительность, подходы, объём, пульс, RPE, самочувствие.',
    input_schema: { type: 'object', properties: { days: int } },
  },
  {
    name: 'get_session_details',
    description: 'Подробности тренировки из приложения: все подходы с повторами/весами/пульсом, время в зонах, подсказки, заметки, связанная активность Garmin.',
    input_schema: { type: 'object', properties: { sessionId: str }, required: ['sessionId'] },
  },
  {
    name: 'get_exercise_history',
    description: 'История выполнения упражнения: даты, повторы, веса, время — для подбора рабочих весов и прогрессии.',
    input_schema: { type: 'object', properties: { exerciseId: str, limit: int }, required: ['exerciseId'] },
  },
  {
    name: 'get_garmin_data',
    description: 'Показатели с часов Garmin за последние N дней (по умолчанию 7): сон, HRV, пульс покоя, Body Battery, готовность, стресс, статус тренированности, VO2max и список активностей.',
    input_schema: { type: 'object', properties: { days: int } },
  },
  {
    name: 'get_garmin_activity',
    description: 'Подробности активности Garmin: круги/отрезки, пульс и темп по времени, каденс, подходы силовой, Training Effect.',
    input_schema: { type: 'object', properties: { activityId: str }, required: ['activityId'] },
  },
  {
    name: 'search_exercises',
    description: 'Поиск упражнений в полной библиотеке приложения (включая расширенную англоязычную базу и созданные упражнения).',
    input_schema: {
      type: 'object',
      properties: { query: str, discipline: str, muscle: str, equipment: str, location: str, limit: int },
    },
  },
  {
    name: 'get_exercise_details',
    description: 'Полное описание упражнения из библиотеки: техника, ошибки, дыхание, противопоказания.',
    input_schema: { type: 'object', properties: { exerciseId: str }, required: ['exerciseId'] },
  },
  {
    name: 'save_athlete_note',
    description: 'Сохраняет долговременную заметку о спортсмене (травма, предпочтение, рабочий вес, реакция на нагрузку, цель). Заметки видны тебе в следующих диалогах.',
    input_schema: {
      type: 'object',
      properties: {
        text: str,
        category: { type: 'string', enum: ['injury', 'preference', 'goal', 'progress', 'health', 'other'] },
      },
      required: ['text'],
    },
  },
];

// ───────────────────────── helpers ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const asInt = (v: any): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(n) : undefined;
};
const asStr = (v: any): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

const KINDS: BlockKind[] = ['warmup', 'main', 'circuit', 'interval', 'cooldown'];

function slug(s: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
  return s
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

export function normalizeWorkout(input: any): { workout: WorkoutTemplate; warnings: string[]; planDate?: string } {
  const warnings: string[] = [];
  const store = useStore.getState();
  const blocks: WorkoutBlock[] = (Array.isArray(input?.blocks) ? input.blocks : []).map((b: any, bi: number) => {
    const kind: BlockKind = KINDS.includes(b?.kind) ? b.kind : 'main';
    const items: WorkoutItem[] = (Array.isArray(b?.items) ? b.items : []).map((it: any) => {
      let exerciseId = asStr(it?.exerciseId);
      const name = asStr(it?.name);
      if (exerciseId && !getExercise(exerciseId)) {
        warnings.push(`Упражнение "${exerciseId}" не найдено в каталоге — сохранено как своё.`);
        exerciseId = undefined;
      }
      if (!exerciseId && (name || asStr(it?.exerciseId))) {
        const title = name ?? asStr(it?.exerciseId)!;
        const id = `coach_${slug(title) || uid('x')}`;
        const existing = getExercise(id);
        const description = asStr(it?.description);
        if (!existing || (description && existing.source === 'coach' && existing.description !== description)) {
          const ex: Exercise = {
            id,
            name: title,
            disciplines: [asStr(input?.discipline) ?? 'strength'],
            locations: [asStr(input?.location) ?? 'home'],
            primaryMuscles: [],
            secondaryMuscles: [],
            equipment: [],
            qualities: [],
            difficulty: 'intermediate',
            measure: it?.durationSec && !it?.reps ? 'time' : it?.distanceM && !it?.reps ? 'distance' : 'reps',
            description: description ?? 'Упражнение, предложенное тренером.',
            steps: [],
            source: 'coach',
          };
          store.upsertCustomExercise(ex);
        }
        exerciseId = id;
      }
      return {
        id: uid('i'),
        exerciseId,
        name,
        sets: asInt(it?.sets),
        reps: asStr(it?.reps),
        durationSec: asInt(it?.durationSec),
        distanceM: asInt(it?.distanceM),
        restSec: it?.restSec === 0 ? 0 : asInt(it?.restSec),
        load: asStr(it?.load),
        tempo: asStr(it?.tempo),
        side: it?.side === 'each' ? 'each' : undefined,
        hrZone: asInt(it?.hrZone),
        notes: asStr(it?.notes),
      } satisfies WorkoutItem;
    });
    return {
      id: uid('b'),
      title: asStr(b?.title) ?? `Блок ${bi + 1}`,
      kind,
      rounds: asInt(b?.rounds) ?? 1,
      restBetweenRoundsSec: asInt(b?.restBetweenRoundsSec),
      items: items.filter((i) => i.exerciseId),
    };
  });
  const intensity = ['easy', 'moderate', 'hard'].includes(input?.intensity) ? (input.intensity as Intensity) : undefined;
  const workout: WorkoutTemplate = {
    id: uid('w'),
    title: asStr(input?.title) ?? 'Тренировка от тренера',
    summary: asStr(input?.summary),
    discipline: asStr(input?.discipline),
    location: asStr(input?.location),
    intensity,
    blocks: blocks.filter((b) => b.items.length),
    createdBy: 'coach',
    createdAt: new Date().toISOString(),
  };
  workout.estimatedMinutes = asInt(input?.estimatedMinutes) ?? estimateMinutes(workout);
  const planDate = asStr(input?.planDate);
  return { workout, warnings, planDate: planDate && /^\d{4}-\d{2}-\d{2}$/.test(planDate) ? planDate : undefined };
}

export function findWorkout(id: string | undefined): WorkoutTemplate | undefined {
  if (!id) return undefined;
  return useStore.getState().savedWorkouts.find((w) => w.id === id) ?? findProgramWorkout(id)?.workout;
}

// ───────────────────────── executors ─────────────────────────

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** a workout to render as a card in the chat */
  workoutId?: string;
  event?: string;
}

export function executeTool(name: string, input: any): ToolOutcome {
  const store = useStore.getState();
  try {
    switch (name) {
      case 'create_workout': {
        const { workout, warnings, planDate } = normalizeWorkout(input);
        if (!workout.blocks.length) return { content: 'Ошибка: в тренировке нет ни одного упражнения.', isError: true };
        store.saveWorkout(workout);
        if (planDate) {
          store.upsertPlanDays([
            {
              id: uid('pd'),
              date: planDate,
              title: workout.title,
              discipline: workout.discipline,
              intensity: workout.intensity,
              description: workout.summary,
              workoutId: workout.id,
              status: 'planned',
            },
          ]);
        }
        return {
          content: JSON.stringify({ ok: true, workoutId: workout.id, estimatedMinutes: workout.estimatedMinutes, planDate, warnings }),
          workoutId: workout.id,
          event: `Тренировка «${workout.title}» сохранена`,
        };
      }
      case 'get_training_plan': {
        const today = todayISO();
        const from = asStr(input?.from) ?? addDays(today, -7);
        const to = asStr(input?.to) ?? addDays(today, 21);
        const days = store.plan.days.filter((d) => d.date >= from && d.date <= to);
        return {
          content: JSON.stringify({
            goal: store.plan.goal,
            notes: store.plan.notes,
            days: days.map((d) => ({ ...d, workoutTitle: findWorkout(d.workoutId)?.title })),
          }),
        };
      }
      case 'update_training_plan': {
        const days: PlanDay[] = (Array.isArray(input?.days) ? input.days : [])
          .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? ''))
          .map((d: any) => ({
            id: uid('pd'),
            date: d.date,
            title: asStr(d.title) ?? 'Тренировка',
            discipline: asStr(d.discipline),
            intensity: ['easy', 'moderate', 'hard', 'rest'].includes(d.intensity) ? d.intensity : undefined,
            description: asStr(d.description),
            workoutId: findWorkout(asStr(d.workoutId)) ? asStr(d.workoutId) : undefined,
            status: 'planned' as const,
          }));
        if (asStr(input?.goal) || asStr(input?.notes)) store.setPlanMeta({ goal: asStr(input?.goal), notes: asStr(input?.notes) });
        if (days.length) store.upsertPlanDays(days);
        const remove = (Array.isArray(input?.removeDates) ? input.removeDates : []).filter((x: unknown) => typeof x === 'string');
        if (remove.length) store.removePlanDays(remove);
        return {
          content: JSON.stringify({ ok: true, updated: days.map((d) => d.date), removed: remove }),
          event: `План обновлён: ${days.length} дн.${remove.length ? `, удалено ${remove.length}` : ''}`,
        };
      }
      case 'get_recent_sessions': {
        const days = asInt(input?.days) ?? 21;
        const since = addDays(todayISO(), -days);
        const list = store.sessions.filter((s) => s.startedAt.slice(0, 10) >= since);
        return { content: list.length ? list.map(sessionLine).join('\n') : 'Тренировок за этот период нет.' };
      }
      case 'get_session_details': {
        const s = store.sessions.find((x) => x.id === input?.sessionId);
        if (!s) return { content: 'Тренировка не найдена.', isError: true };
        const act = s.garminActivityId ? store.garmin.activities.find((a) => a.id === s.garminActivityId) : undefined;
        return {
          content: JSON.stringify({
            id: s.id,
            title: s.title,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            rpe: s.rpe,
            feeling: s.feeling,
            notes: s.notes,
            metrics: s.metrics,
            hrSource: s.hrSource,
            plannedWorkout: s.template.title,
            sets: s.sets.map((x) => ({
              exercise: x.exerciseName,
              round: x.round,
              set: x.setIndex,
              reps: x.reps,
              weightKg: x.weightKg,
              durationSec: x.durationSec,
              distanceM: x.distanceM,
              rpe: x.rpe,
              skipped: x.skipped,
              avgHR: x.avgHR,
              maxHR: x.maxHR,
            })),
            liveTips: s.tips.map((t) => `${Math.round(t.t / 60)} мин: ${t.text}`),
            garminActivity: act ? activityLine(act) : undefined,
          }),
        };
      }
      case 'get_exercise_history': {
        const id = asStr(input?.exerciseId);
        const limit = asInt(input?.limit) ?? 30;
        const rows: string[] = [];
        for (const s of store.sessions) {
          const sets = s.sets.filter((x) => x.exerciseId === id && !x.skipped);
          if (!sets.length) continue;
          rows.push(
            `${s.startedAt.slice(0, 10)}: ` +
              sets
                .map((x) => [x.weightKg ? `${x.weightKg} кг` : '', x.reps ? `×${x.reps}` : '', x.durationSec ? `${x.durationSec} с` : '', x.distanceM ? `${x.distanceM} м` : '', x.rpe ? `RPE ${x.rpe}` : ''].filter(Boolean).join(' '))
                .join('; '),
          );
          if (rows.length >= limit) break;
        }
        return { content: rows.length ? rows.join('\n') : 'Это упражнение ещё не выполнялось в приложении.' };
      }
      case 'get_garmin_data': {
        const days = asInt(input?.days) ?? 7;
        const since = addDays(todayISO(), -days);
        const daily = store.garmin.daily.filter((d) => d.date >= since).sort((a, b) => b.date.localeCompare(a.date));
        const acts = store.garmin.activities.filter((a) => a.start.slice(0, 10) >= since);
        if (!daily.length && !acts.length) {
          return { content: 'Данных Garmin за этот период нет (синхронизация не настроена или ещё не выполнялась).' };
        }
        return {
          content: [
            `Обновлено: ${store.garmin.updatedAt ?? 'неизвестно'}`,
            'Дни:',
            ...daily.map((d) => `- ${dailyLine(d)}`),
            'Активности:',
            ...acts.map((a) => `- ${activityLine(a)}`),
          ].join('\n'),
        };
      }
      case 'get_garmin_activity': {
        const a = store.garmin.activities.find((x) => x.id === input?.activityId);
        if (!a) return { content: 'Активность не найдена.', isError: true };
        const series = (a.series ?? []).filter((_, i, arr) => arr.length < 120 || i % Math.ceil(arr.length / 120) === 0);
        return {
          content: JSON.stringify({
            ...a,
            series: undefined,
            seriesFormat: '[сек от старта, пульс, скорость м/с, каденс]',
            seriesSampled: series,
          }),
        };
      }
      case 'search_exercises': {
        const list = filterExercises(allExercises(true), {
          query: asStr(input?.query),
          discipline: asStr(input?.discipline),
          muscle: asStr(input?.muscle),
          equipment: asStr(input?.equipment),
          location: asStr(input?.location),
        }).slice(0, asInt(input?.limit) ?? 25);
        return {
          content: list.length
            ? list.map((e) => `${e.id} | ${e.name} | ${e.disciplines.join(',')} | ${e.primaryMuscles.join(',')} | ${e.equipment.join(',')}`).join('\n')
            : 'Ничего не найдено.',
        };
      }
      case 'get_exercise_details': {
        const e = getExercise(asStr(input?.exerciseId));
        if (!e) return { content: 'Упражнение не найдено.', isError: true };
        return { content: JSON.stringify(e) };
      }
      case 'save_athlete_note': {
        const text = asStr(input?.text);
        if (!text) return { content: 'Пустая заметка.', isError: true };
        store.addCoachNote({ text, category: asStr(input?.category) ?? 'other' });
        return { content: 'Заметка сохранена.', event: `Тренер запомнил: ${text}` };
      }
      default:
        return { content: `Неизвестный инструмент ${name}`, isError: true };
    }
  } catch (e) {
    return { content: `Ошибка выполнения инструмента: ${(e as Error).message}`, isError: true };
  }
}
