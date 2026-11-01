import { useStore } from '../store/store';
import type { BlockKind, Exercise, Intensity, WorkoutBlock, WorkoutItem, WorkoutTemplate } from '../types';
import { getExercise, findProgramWorkout } from '../data/library';
import { uid } from '../lib/id';
import { estimateMinutes } from '../lib/workoutFlow';

export const str = { type: 'string' } as const;
export const int = { type: 'integer' } as const;

export const ITEM_SCHEMA = {
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


export const BLOCKS_SCHEMA = {
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
};

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** in-app link shown with the event in the chat */
  link?: string;
  /** a workout to render as a card in the chat */
  workoutId?: string;
  event?: string;
}


/* eslint-disable @typescript-eslint/no-explicit-any */
export const asInt = (v: any): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(n) : undefined;
};
export const asStr = (v: any): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

const KINDS: BlockKind[] = ['warmup', 'main', 'circuit', 'interval', 'cooldown'];

export function slug(s: string): string {
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

export interface NormalizeCtx {
  discipline?: string;
  location?: string;
  warnings: string[];
}

/** Blocks/items from Claude's tool input. Unknown exercise ids become the coach's own exercises. */
export function normalizeBlocks(rawBlocks: any, ctx: NormalizeCtx): WorkoutBlock[] {
  const { warnings } = ctx;
  const store = useStore.getState();
  const blocks: WorkoutBlock[] = (Array.isArray(rawBlocks) ? rawBlocks : []).map((b: any, bi: number) => {
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
            disciplines: [ctx.discipline ?? 'strength'],
            locations: [ctx.location ?? 'home'],
            primaryMuscles: [],
            secondaryMuscles: [],
            equipment: [],
            qualities: [],
            difficulty: 'intermediate',
            measure: it?.durationSec && !it?.reps ? 'time' : it?.distanceM && !it?.reps ? 'distance' : 'reps',
            description: description ?? 'Упражнение, предложенное тренером.',
            steps: [],
            source: 'coach',
            updatedAt: new Date().toISOString(),
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
  return blocks.filter((b) => b.items.length);
}

export const INTENSITY_VALUES = ['easy', 'moderate', 'hard'];

/** A whole workout from tool input. `base` keeps id/metadata when an existing workout is replaced. */
export function normalizeWorkout(input: any, base?: WorkoutTemplate): { workout: WorkoutTemplate; warnings: string[]; planDate?: string } {
  const warnings: string[] = [];
  const discipline = asStr(input?.discipline) ?? base?.discipline;
  const location = asStr(input?.location) ?? base?.location;
  const blocks = input?.blocks !== undefined ? normalizeBlocks(input.blocks, { discipline, location, warnings }) : base?.blocks ?? [];
  const intensity = INTENSITY_VALUES.includes(input?.intensity) ? (input.intensity as Intensity) : base?.intensity;
  const workout: WorkoutTemplate = {
    ...base,
    id: base?.id ?? uid('w'),
    title: asStr(input?.title) ?? base?.title ?? 'Тренировка от тренера',
    summary: asStr(input?.summary) ?? base?.summary,
    focus: asStr(input?.focus) ?? base?.focus,
    notes: asStr(input?.notes) ?? base?.notes,
    discipline,
    location,
    intensity,
    blocks,
    createdBy: base?.createdBy ?? 'coach',
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  workout.estimatedMinutes = asInt(input?.estimatedMinutes) ?? (input?.blocks !== undefined ? undefined : base?.estimatedMinutes);
  workout.estimatedMinutes ??= estimateMinutes({ ...workout, estimatedMinutes: undefined });
  const planDate = asStr(input?.planDate);
  return { workout, warnings, planDate: planDate && /^\d{4}-\d{2}-\d{2}$/.test(planDate) ? planDate : undefined };
}

export function findWorkout(id: string | undefined): WorkoutTemplate | undefined {
  if (!id) return undefined;
  return useStore.getState().savedWorkouts.find((w) => w.id === id) ?? findProgramWorkout(id)?.workout;
}

