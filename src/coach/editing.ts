// Coach tools for creating and editing the library: exercises, programs and workouts.
// Edits of built-in items are stored as copies with the same id (the original can be restored).
import type Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../store/store';
import type { Difficulty, Exercise, ExerciseDefaults, Measure, Program, WorkoutTemplate } from '../types';
import {
  allPrograms,
  exerciseOrigin,
  fedbLoaded,
  findProgramWorkout,
  getExercise,
  getProgram,
  programOrigin,
} from '../data/library';
import { DIFFICULTIES, DISCIPLINES, EQUIPMENT, LOCATIONS, MUSCLES, QUALITIES, type Tag } from '../data/taxonomy';
import { uid } from '../lib/id';
import { asInt, asStr, BLOCKS_SCHEMA, findWorkout, INTENSITY_VALUES, int, normalizeWorkout, slug, str, type ToolOutcome } from './normalize';

type Tool = Anthropic.Beta.BetaTool;

const ids = (list: Tag[]) => list.map((t) => t.id);
const enumArray = (list: Tag[], description?: string) => ({
  type: 'array',
  items: { type: 'string', enum: ids(list) },
  ...(description ? { description } : {}),
});
const strArray = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const EXERCISE_PROPS = {
  name: { type: 'string', description: 'название на русском' },
  nameEn: str,
  sanskrit: { type: 'string', description: 'для асан — название на санскрите латиницей' },
  description: { type: 'string', description: '2–3 предложения: что это и зачем' },
  steps: strArray('техника: 4–7 шагов в повелительном наклонении'),
  tips: strArray('2–4 совета'),
  mistakes: strArray('2–4 частые ошибки'),
  breathing: { type: 'string', description: 'дыхание, 1 предложение' },
  contraindications: str,
  variations: strArray('как упростить / усложнить'),
  disciplines: enumArray(DISCIPLINES),
  locations: enumArray(LOCATIONS),
  primaryMuscles: enumArray(MUSCLES),
  secondaryMuscles: enumArray(MUSCLES),
  equipment: enumArray(EQUIPMENT),
  qualities: enumArray(QUALITIES, 'что развивает'),
  difficulty: { type: 'string', enum: ids(DIFFICULTIES) },
  measure: { type: 'string', enum: ['reps', 'time', 'distance'], description: 'повторы, время или дистанция' },
  weighted: { type: 'boolean', description: 'выполняется с отягощением (вводится вес)' },
  unilateral: { type: 'boolean', description: 'на каждую сторону отдельно' },
  hrZone: { type: 'integer', description: 'типичная зона пульса 1–5 (для кардио)' },
  defaults: {
    type: 'object',
    description: 'параметры по умолчанию',
    properties: { sets: int, reps: str, durationSec: int, distanceM: int, restSec: int },
  },
  photo: {
    type: 'string',
    description: 'id фото из базы free-exercise-db (из search_exercises: "fedb:Barbell_Squat" или "Barbell_Squat"); пустая строка — убрать фото',
  },
  videoQuery: { type: 'string', description: 'запрос для поиска видео техники на YouTube' },
};

const WORKOUT_PROPS = {
  title: str,
  focus: { type: 'string', description: 'фокус тренировки, коротко' },
  summary: str,
  estimatedMinutes: int,
  intensity: { type: 'string', enum: INTENSITY_VALUES },
  notes: str,
  blocks: BLOCKS_SCHEMA,
};

export const EDIT_TOOLS: Tool[] = [
  {
    name: 'save_exercise',
    description:
      'Создаёт новое упражнение в библиотеке или изменяет существующее (включая встроенные — исходник можно будет восстановить). Для изменения укажи exerciseId и только те поля, которые меняешь. Для нового — не указывай exerciseId и заполни name, description, steps и теги. Возвращает exerciseId.',
    input_schema: {
      type: 'object',
      properties: { exerciseId: { type: 'string', description: 'id изменяемого упражнения; пусто — создать новое' }, ...EXERCISE_PROPS },
    },
  },
  {
    name: 'get_program',
    description:
      'Без programId — список всех программ (встроенных, созданных и изменённых) с id тренировок. С programId — полная структура программы: тренировки, блоки, упражнения, подходы. Смотри её перед изменением.',
    input_schema: { type: 'object', properties: { programId: str } },
  },
  {
    name: 'save_program',
    description:
      'Создаёт новую программу тренировок или изменяет существующую (включая встроенные — исходник можно восстановить). Для изменения укажи programId и только меняемые поля; если передаёшь workouts — это полный новый список тренировок программы (для сохранения id существующей тренировки передай её workoutId). Чтобы поправить одну тренировку, удобнее update_workout.',
    input_schema: {
      type: 'object',
      properties: {
        programId: { type: 'string', description: 'id изменяемой программы; пусто — создать новую' },
        title: str,
        subtitle: { type: 'string', description: 'одна строка: например «3 тренировки в неделю, всё тело»' },
        discipline: { type: 'string', enum: ids(DISCIPLINES) },
        locations: enumArray(LOCATIONS),
        level: { type: 'string', enum: ids(DIFFICULTIES) },
        goal: str,
        description: str,
        weeks: int,
        sessionsPerWeek: int,
        equipment: enumArray(EQUIPMENT),
        qualities: enumArray(QUALITIES),
        schedule: { type: 'string', description: 'расписание по дням недели' },
        progression: { type: 'string', description: 'как повышать нагрузку' },
        workouts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { workoutId: { type: 'string', description: 'id существующей тренировки этой программы, если её сохраняешь' }, ...WORKOUT_PROPS },
            required: ['title', 'blocks'],
          },
        },
      },
    },
  },
  {
    name: 'update_workout',
    description:
      'Изменяет существующую тренировку — сохранённую (от тренера) или из программы. Укажи workoutId и меняемые поля; blocks — полный новый состав тренировки. id сохраняется, поэтому ссылки из плана остаются рабочими.',
    input_schema: {
      type: 'object',
      properties: { workoutId: str, ...WORKOUT_PROPS },
      required: ['workoutId'],
    },
  },
  {
    name: 'delete_custom_item',
    description:
      'Удаляет созданное упражнение, программу или сохранённую тренировку, либо отменяет изменения встроенного упражнения/программы (восстанавливает оригинал). Вызывай только по явной просьбе пользователя.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['exercise', 'program', 'workout'] }, id: str },
      required: ['kind', 'id'],
    },
  },
];

// ───────────────────────── helpers ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function vocabArray(value: any, list: Tag[], field: string, warnings: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const allowed = new Set(ids(list));
  const arr = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
  const bad = arr.filter((v) => !allowed.has(v));
  if (bad.length) warnings.push(`${field}: пропущены неизвестные значения ${bad.join(', ')}`);
  return [...new Set(arr.filter((v) => allowed.has(v)))];
}

function strList(value: any): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).map((v) => asStr(v)).filter((v): v is string => !!v);
}

function uniqueId(base: string, exists: (id: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; ; i++) if (!exists(`${base}_${i}`)) return `${base}_${i}`;
}

const now = () => new Date().toISOString();

function normalizeDefaults(v: any, prev?: ExerciseDefaults): ExerciseDefaults | undefined {
  if (!v || typeof v !== 'object') return prev;
  const d: ExerciseDefaults = {
    sets: asInt(v.sets),
    reps: asStr(v.reps),
    durationSec: asInt(v.durationSec),
    distanceM: asInt(v.distanceM),
    restSec: v.restSec === 0 ? 0 : asInt(v.restSec),
  };
  return Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined)) as ExerciseDefaults;
}

function compactWorkout(w: WorkoutTemplate) {
  return {
    workoutId: w.id,
    title: w.title,
    focus: w.focus,
    summary: w.summary,
    estimatedMinutes: w.estimatedMinutes,
    intensity: w.intensity,
    notes: w.notes,
    blocks: w.blocks.map((b) => ({
      title: b.title,
      kind: b.kind,
      rounds: b.rounds,
      restBetweenRoundsSec: b.restBetweenRoundsSec,
      items: b.items.map(({ id: _id, ...it }) => it),
    })),
  };
}

// ───────────────────────── executors ─────────────────────────

function saveExercise(input: any): ToolOutcome {
  const store = useStore.getState();
  const warnings: string[] = [];
  const requestedId = asStr(input?.exerciseId);
  const existing = requestedId ? getExercise(requestedId) : undefined;
  if (requestedId && !existing) {
    return { content: `Упражнение "${requestedId}" не найдено. Чтобы создать новое, вызови save_exercise без exerciseId.`, isError: true };
  }
  const name = asStr(input?.name);
  if (!existing && !name) return { content: 'Для нового упражнения нужно название (name).', isError: true };

  const patch: Partial<Exercise> = {
    name,
    nameEn: asStr(input?.nameEn),
    sanskrit: asStr(input?.sanskrit),
    description: asStr(input?.description),
    steps: strList(input?.steps),
    tips: strList(input?.tips),
    mistakes: strList(input?.mistakes),
    breathing: asStr(input?.breathing),
    contraindications: asStr(input?.contraindications),
    variations: strList(input?.variations),
    disciplines: vocabArray(input?.disciplines, DISCIPLINES, 'disciplines', warnings),
    locations: vocabArray(input?.locations, LOCATIONS, 'locations', warnings),
    primaryMuscles: vocabArray(input?.primaryMuscles, MUSCLES, 'primaryMuscles', warnings),
    secondaryMuscles: vocabArray(input?.secondaryMuscles, MUSCLES, 'secondaryMuscles', warnings),
    equipment: vocabArray(input?.equipment, EQUIPMENT, 'equipment', warnings),
    qualities: vocabArray(input?.qualities, QUALITIES, 'qualities', warnings),
    difficulty: ids(DIFFICULTIES).includes(input?.difficulty) ? (input.difficulty as Difficulty) : undefined,
    measure: ['reps', 'time', 'distance'].includes(input?.measure) ? (input.measure as Measure) : undefined,
    weighted: typeof input?.weighted === 'boolean' ? input.weighted : undefined,
    unilateral: typeof input?.unilateral === 'boolean' ? input.unilateral : undefined,
    hrZone: asInt(input?.hrZone),
    videoQuery: asStr(input?.videoQuery),
    defaults: input?.defaults !== undefined ? normalizeDefaults(input.defaults, existing?.defaults) : undefined,
  };
  if (input?.photo !== undefined) {
    const raw = String(input.photo ?? '').replace(/^fedb:/, '').trim();
    if (!raw) patch.fedb = null;
    else if (!/^[\w\-().',]+$/.test(raw)) warnings.push('photo: некорректный id фото — пропущено');
    else if (fedbLoaded() && !getExercise(`fedb:${raw}`)) warnings.push(`photo: "${raw}" не найдено в базе free-exercise-db — пропущено`);
    else {
      patch.fedb = raw;
      if (!fedbLoaded()) warnings.push('photo: база фото не загружена в приложение, id не проверен');
    }
  }
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<Exercise>;

  let ex: Exercise;
  if (existing) {
    ex = { ...existing, ...defined, id: existing.id, updatedAt: now() };
  } else {
    const id = uniqueId(`coach_${slug(name!) || uid('x')}`, (x) => !!getExercise(x));
    ex = {
      id,
      name: name!,
      disciplines: ['strength'],
      locations: ['gym', 'home', 'outdoor'],
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: [],
      qualities: [],
      difficulty: 'intermediate',
      measure: 'reps',
      description: 'Упражнение, добавленное тренером.',
      steps: [],
      ...defined,
      source: 'coach',
      updatedAt: now(),
    };
    if (!ex.disciplines.length) ex.disciplines = ['strength'];
  }
  store.upsertCustomExercise(ex);
  return {
    content: JSON.stringify({ ok: true, exerciseId: ex.id, action: existing ? 'updated' : 'created', warnings }),
    event: existing ? `Упражнение изменено: ${ex.name}` : `Новое упражнение: ${ex.name}`,
    link: `/exercises/${encodeURIComponent(ex.id)}`,
  };
}

function getProgramTool(input: any): ToolOutcome {
  const pid = asStr(input?.programId);
  if (!pid) {
    return {
      content: allPrograms()
        .map((p) => `${p.id} | ${p.title} | ${p.discipline} | ${p.level} | ${programOrigin(p.id)} | тренировки: ${p.workouts.map((w) => `${w.id} «${w.title}»`).join(', ')}`)
        .join('\n'),
    };
  }
  const p = getProgram(pid);
  if (!p) return { content: `Программа "${pid}" не найдена.`, isError: true };
  const { workouts, ...meta } = p;
  return { content: JSON.stringify({ ...meta, origin: programOrigin(p.id), workouts: workouts.map(compactWorkout) }) };
}

function saveProgram(input: any): ToolOutcome {
  const store = useStore.getState();
  const warnings: string[] = [];
  const requestedId = asStr(input?.programId);
  const existing = requestedId ? getProgram(requestedId) : undefined;
  if (requestedId && !existing) {
    return { content: `Программа "${requestedId}" не найдена. Чтобы создать новую, вызови save_program без programId.`, isError: true };
  }
  const title = asStr(input?.title);
  if (!existing && !title) return { content: 'Для новой программы нужно название (title).', isError: true };
  if (!existing && !(Array.isArray(input?.workouts) && input.workouts.length)) {
    return { content: 'В новой программе должна быть хотя бы одна тренировка (workouts).', isError: true };
  }
  const id = existing?.id ?? uniqueId(`coach_${slug(title!) || uid('p')}`, (x) => !!getProgram(x));
  const discipline = ids(DISCIPLINES).includes(input?.discipline) ? input.discipline : existing?.discipline ?? 'strength';

  let workouts = existing?.workouts ?? [];
  if (Array.isArray(input?.workouts)) {
    const used = new Set<string>();
    workouts = [];
    input.workouts.forEach((w: any, i: number) => {
      const prev = existing?.workouts.find((x) => x.id === asStr(w?.workoutId));
      const base: WorkoutTemplate =
        prev ??
        ({
          id: uniqueId(`${id}_${slug(asStr(w?.title) ?? '') || i + 1}`, (x) => used.has(x) || (!!findWorkout(x) && !existing?.workouts.some((y) => y.id === x))),
          title: asStr(w?.title) ?? `Тренировка ${i + 1}`,
          blocks: [],
          createdBy: 'program',
        } as WorkoutTemplate);
      const { workout, warnings: ws } = normalizeWorkout({ discipline, ...w }, base);
      warnings.push(...ws);
      if (!workout.blocks.length) {
        warnings.push(`Тренировка «${workout.title}» пропущена: в ней нет упражнений.`);
        return;
      }
      used.add(workout.id);
      workouts.push({ ...workout, programId: id, createdBy: 'program' });
    });
    if (!workouts.length) return { content: 'Ни одна тренировка не сохранена: в них нет упражнений.', isError: true };
  }

  const program: Program = {
    ...(existing ?? { locations: ['gym'], level: 'beginner' as Difficulty }),
    id,
    title: title ?? existing!.title,
    subtitle: asStr(input?.subtitle) ?? existing?.subtitle,
    discipline,
    locations: vocabArray(input?.locations, LOCATIONS, 'locations', warnings) ?? existing?.locations ?? ['gym'],
    level: ids(DIFFICULTIES).includes(input?.level) ? input.level : existing?.level ?? 'beginner',
    goal: asStr(input?.goal) ?? existing?.goal,
    description: asStr(input?.description) ?? existing?.description,
    weeks: asInt(input?.weeks) ?? existing?.weeks,
    sessionsPerWeek: asInt(input?.sessionsPerWeek) ?? existing?.sessionsPerWeek,
    equipment: vocabArray(input?.equipment, EQUIPMENT, 'equipment', warnings) ?? existing?.equipment,
    qualities: vocabArray(input?.qualities, QUALITIES, 'qualities', warnings) ?? existing?.qualities,
    schedule: asStr(input?.schedule) ?? existing?.schedule,
    progression: asStr(input?.progression) ?? existing?.progression,
    workouts,
    source: 'coach',
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  store.upsertCustomProgram(program);
  return {
    content: JSON.stringify({ ok: true, programId: id, action: existing ? 'updated' : 'created', workoutIds: workouts.map((w) => w.id), warnings }),
    event: existing ? `Программа изменена: ${program.title}` : `Новая программа: ${program.title}`,
    link: `/programs/${encodeURIComponent(id)}`,
  };
}

function updateWorkout(input: any): ToolOutcome {
  const store = useStore.getState();
  const wid = asStr(input?.workoutId);
  if (!wid) return { content: 'Нужен workoutId.', isError: true };
  const { workoutId: _w, ...fields } = input ?? {};
  const saved = store.savedWorkouts.find((w) => w.id === wid);
  if (saved) {
    const { workout, warnings } = normalizeWorkout(fields, saved);
    if (!workout.blocks.length) return { content: 'В тренировке не осталось упражнений.', isError: true };
    store.saveWorkout(workout);
    return { content: JSON.stringify({ ok: true, workoutId: wid, warnings }), workoutId: wid, event: `Тренировка изменена: ${workout.title}` };
  }
  const found = findProgramWorkout(wid);
  if (found) {
    const { workout, warnings } = normalizeWorkout({ discipline: found.program.discipline, ...fields }, found.workout);
    if (!workout.blocks.length) return { content: 'В тренировке не осталось упражнений.', isError: true };
    const program: Program = {
      ...found.program,
      workouts: found.program.workouts.map((w) => (w.id === wid ? { ...workout, programId: found.program.id, createdBy: 'program' } : w)),
      source: 'coach',
      updatedAt: now(),
    };
    store.upsertCustomProgram(program);
    return {
      content: JSON.stringify({ ok: true, workoutId: wid, programId: program.id, warnings }),
      workoutId: wid,
      event: `Тренировка «${workout.title}» в программе «${program.title}» изменена`,
    };
  }
  return { content: `Тренировка "${wid}" не найдена.`, isError: true };
}

function deleteItem(input: any): ToolOutcome {
  const store = useStore.getState();
  const id = asStr(input?.id);
  if (!id) return { content: 'Нужен id.', isError: true };
  switch (input?.kind) {
    case 'exercise': {
      if (!store.customExercises.some((e) => e.id === id)) return { content: 'Это встроенное упражнение без изменений — удалить его нельзя.', isError: true };
      const origin = exerciseOrigin(id);
      store.removeCustomExercise(id);
      return origin === 'custom'
        ? { content: 'Упражнение удалено.', event: 'Упражнение удалено' }
        : { content: 'Изменения отменены, восстановлен оригинал.', event: 'Упражнение восстановлено', link: `/exercises/${encodeURIComponent(id)}` };
    }
    case 'program': {
      if (!store.customPrograms.some((p) => p.id === id)) return { content: 'Это встроенная программа без изменений — удалить её нельзя.', isError: true };
      const origin = programOrigin(id);
      store.removeCustomProgram(id);
      return origin === 'custom'
        ? { content: 'Программа удалена.', event: 'Программа удалена' }
        : { content: 'Изменения отменены, восстановлен оригинал.', event: 'Программа восстановлена', link: `/programs/${encodeURIComponent(id)}` };
    }
    case 'workout': {
      if (!store.savedWorkouts.some((w) => w.id === id)) {
        return { content: 'Сохранённая тренировка не найдена (тренировки программ меняются через save_program/update_workout).', isError: true };
      }
      store.deleteWorkout(id);
      return { content: 'Тренировка удалена.', event: 'Тренировка удалена' };
    }
    default:
      return { content: 'kind должен быть exercise, program или workout.', isError: true };
  }
}

export function executeEditTool(name: string, input: any): ToolOutcome | undefined {
  switch (name) {
    case 'save_exercise':
      return saveExercise(input);
    case 'get_program':
      return getProgramTool(input);
    case 'save_program':
      return saveProgram(input);
    case 'update_workout':
      return updateWorkout(input);
    case 'delete_custom_item':
      return deleteItem(input);
    default:
      return undefined;
  }
}
