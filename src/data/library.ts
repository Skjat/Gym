import type { Exercise, Program, WorkoutTemplate, WorkoutBlock, WorkoutItem } from '../types';
import { uid } from '../lib/id';

// All JSON files in ./exercises and ./programs are bundled at build time.
const exerciseModules = import.meta.glob<{ default: Exercise[] }>('./exercises/*.json', { eager: true });
const programModules = import.meta.glob<{ default: Program[] }>('./programs/*.json', { eager: true });

export const FEDB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';

export function withIds(t: WorkoutTemplate, programId?: string): WorkoutTemplate {
  return {
    ...t,
    programId: programId ?? t.programId,
    createdBy: t.createdBy ?? 'program',
    blocks: (t.blocks ?? []).map(
      (b, bi): WorkoutBlock => ({
        ...b,
        id: b.id ?? `${t.id}_b${bi}`,
        items: (b.items ?? []).map(
          (it, ii): WorkoutItem => ({ ...it, id: it.id ?? `${t.id}_b${bi}_i${ii}` }),
        ),
      }),
    ),
  };
}

export const BUILTIN_EXERCISES: Exercise[] = Object.values(exerciseModules)
  .flatMap((m) => m.default ?? [])
  .map((e) => ({ ...e, source: 'builtin' as const }));

export const BUILTIN_PROGRAMS: Program[] = Object.values(programModules)
  .flatMap((m) => m.default ?? [])
  .map((p) => ({ ...p, source: 'builtin' as const, workouts: (p.workouts ?? []).map((w) => withIds(w, p.id)) }));

const builtinById = new Map(BUILTIN_EXERCISES.map((e) => [e.id, e]));
const builtinProgramById = new Map(BUILTIN_PROGRAMS.map((p) => [p.id, p]));
let customById = new Map<string, Exercise>();
let customProgramById = new Map<string, Program>();
let fedbById = new Map<string, Exercise>();

/** Custom exercises: new ones created by the coach/user and edited copies of built-in ones (same id). */
export function setCustomExercises(list: Exercise[]) {
  customById = new Map(list.map((e) => [e.id, e]));
}

/** Custom programs: new ones and edited copies of built-in ones (same id). */
export function setCustomPrograms(list: Program[]) {
  customProgramById = new Map(list.map((p) => [p.id, p]));
}

export function isBuiltinExercise(id: string | undefined): boolean {
  return !!id && builtinById.has(id);
}

export function isBuiltinProgram(id: string | undefined): boolean {
  return !!id && builtinProgramById.has(id);
}

export function getBuiltinExercise(id: string): Exercise | undefined {
  return builtinById.get(id);
}

/** 'builtin' | 'edited' (built-in changed by the coach) | 'custom' (created) | 'fedb' */
export function exerciseOrigin(id: string): 'builtin' | 'edited' | 'custom' | 'fedb' {
  if (customById.has(id)) return builtinById.has(id) ? 'edited' : id.startsWith('fedb:') ? 'fedb' : 'custom';
  if (builtinById.has(id)) return 'builtin';
  return 'fedb';
}

export function programOrigin(id: string): 'builtin' | 'edited' | 'custom' {
  if (customProgramById.has(id)) return builtinProgramById.has(id) ? 'edited' : 'custom';
  return 'builtin';
}

export function setFedbExercises(list: Exercise[]) {
  fedbById = new Map(list.map((e) => [e.id, e]));
}

export function fedbLoaded(): boolean {
  return fedbById.size > 0;
}

export function getExercise(id: string | undefined): Exercise | undefined {
  if (!id) return undefined;
  return customById.get(id) ?? builtinById.get(id) ?? fedbById.get(id);
}

/** Built-in (with edits applied) + created + optionally the free-exercise-db import. */
export function allExercises(includeFedb = true): Exercise[] {
  const list = BUILTIN_EXERCISES.map((e) => customById.get(e.id) ?? e);
  for (const e of customById.values()) {
    if (!builtinById.has(e.id) && (includeFedb || !e.id.startsWith('fedb:'))) list.push(e);
  }
  if (includeFedb) for (const e of fedbById.values()) if (!customById.has(e.id)) list.push(e);
  return list;
}

export function allPrograms(): Program[] {
  const list = BUILTIN_PROGRAMS.map((p) => customProgramById.get(p.id) ?? p);
  for (const p of customProgramById.values()) if (!builtinProgramById.has(p.id)) list.push(p);
  return list;
}

export function getProgram(id: string | undefined): Program | undefined {
  if (!id) return undefined;
  return customProgramById.get(id) ?? builtinProgramById.get(id);
}

export function findProgramWorkout(id: string): { program: Program; workout: WorkoutTemplate } | undefined {
  for (const program of allPrograms()) {
    const workout = program.workouts.find((w) => w.id === id);
    if (workout) return { program, workout };
  }
  return undefined;
}

/** Start / end position photos (public-domain free-exercise-db). */
export function exerciseImages(ex: Exercise | undefined): string[] {
  if (!ex?.fedb) return [];
  return [0, 1].map((i) => `${FEDB_BASE}/exercises/${ex.fedb}/${i}.jpg`);
}

export function videoSearchUrl(ex: Exercise | undefined, fallbackName?: string): string {
  const q = ex?.videoQuery || `${ex?.name ?? fallbackName ?? ''} техника выполнения`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export function itemName(item: WorkoutItem): string {
  return getExercise(item.exerciseId)?.name ?? item.name ?? item.exerciseId ?? 'Упражнение';
}

// ───────────────────── search & filters ─────────────────────

export interface ExerciseFilter {
  query?: string;
  discipline?: string;
  location?: string;
  muscle?: string;
  equipment?: string;
  quality?: string;
  difficulty?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function filterExercises(list: Exercise[], f: ExerciseFilter): Exercise[] {
  const q = f.query ? norm(f.query.trim()) : '';
  const words = q.split(/\s+/).filter(Boolean);
  return list.filter((e) => {
    if (f.discipline && !e.disciplines.includes(f.discipline)) return false;
    if (f.location && !e.locations.includes(f.location)) return false;
    if (f.muscle && !e.primaryMuscles.includes(f.muscle) && !e.secondaryMuscles.includes(f.muscle)) return false;
    if (f.equipment && !e.equipment.includes(f.equipment)) return false;
    if (f.quality && !e.qualities.includes(f.quality)) return false;
    if (f.difficulty && e.difficulty !== f.difficulty) return false;
    if (words.length) {
      const hay = norm(`${e.name} ${e.nameEn ?? ''} ${e.sanskrit ?? ''} ${e.id}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

// ───────────────────── free-exercise-db import ─────────────────────

interface FedbRaw {
  id: string;
  name: string;
  force?: string | null;
  level?: string;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
}

const FEDB_MUSCLE: Record<string, string> = {
  quadriceps: 'quads',
  shoulders: 'shoulders',
  abdominals: 'abs',
  chest: 'chest',
  hamstrings: 'hamstrings',
  triceps: 'triceps',
  biceps: 'biceps',
  lats: 'lats',
  'middle back': 'upper_back',
  calves: 'calves',
  'lower back': 'lower_back',
  forearms: 'forearms',
  glutes: 'glutes',
  traps: 'traps',
  adductors: 'adductors',
  neck: 'neck',
  abductors: 'abductors',
};

const FEDB_EQUIP: Record<string, string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  'body only': 'none',
  cable: 'cable',
  machine: 'machine',
  kettlebells: 'kettlebell',
  bands: 'bands',
  'medicine ball': 'medicine_ball',
  'exercise ball': 'fitball',
  'foam roll': 'foam_roller',
  'e-z curl bar': 'ez_bar',
};

const FEDB_CATEGORY: Record<string, { discipline: string; quality: string }> = {
  strength: { discipline: 'strength', quality: 'strength' },
  stretching: { discipline: 'stretching', quality: 'flexibility' },
  plyometrics: { discipline: 'plyometrics', quality: 'power' },
  powerlifting: { discipline: 'strength', quality: 'strength' },
  'olympic weightlifting': { discipline: 'strength', quality: 'power' },
  strongman: { discipline: 'strength', quality: 'strength' },
  cardio: { discipline: 'cardio', quality: 'cardio' },
};

export function convertFedb(raw: FedbRaw): Exercise {
  const cat = FEDB_CATEGORY[raw.category ?? ''] ?? FEDB_CATEGORY.strength;
  const equip = raw.equipment ? FEDB_EQUIP[raw.equipment] : undefined;
  const locations =
    equip === 'none' || equip === 'bands'
      ? ['home', 'outdoor', 'gym']
      : equip === 'dumbbell' || equip === 'kettlebell' || equip === 'fitball' || equip === 'foam_roller' || equip === 'medicine_ball'
        ? ['gym', 'home']
        : ['gym'];
  const timeBased = raw.category === 'stretching' || raw.force === 'static';
  return {
    id: `fedb:${raw.id}`,
    name: raw.name,
    nameEn: raw.name,
    disciplines: [cat.discipline],
    locations,
    primaryMuscles: (raw.primaryMuscles ?? []).map((m) => FEDB_MUSCLE[m]).filter(Boolean),
    secondaryMuscles: (raw.secondaryMuscles ?? []).map((m) => FEDB_MUSCLE[m]).filter(Boolean),
    equipment: equip ? [equip] : [],
    qualities: [cat.quality],
    difficulty: raw.level === 'expert' ? 'advanced' : raw.level === 'intermediate' ? 'intermediate' : 'beginner',
    measure: timeBased ? 'time' : 'reps',
    weighted: equip !== undefined && equip !== 'none' && equip !== 'bands' && equip !== 'foam_roller',
    description: 'Упражнение из открытой базы free-exercise-db (описание на английском). Нажмите «Перевести с Claude», чтобы получить описание на русском.',
    steps: raw.instructions ?? [],
    fedb: raw.id,
    videoQuery: `${raw.name} exercise technique`,
    defaults: timeBased ? { sets: 1, durationSec: 30 } : { sets: 3, reps: '10-12', restSec: 90 },
    source: 'fedb',
  };
}

export async function downloadFedb(): Promise<Exercise[]> {
  const res = await fetch(`${FEDB_BASE}/dist/exercises.json`);
  if (!res.ok) throw new Error(`Не удалось загрузить базу упражнений (${res.status})`);
  const raw = (await res.json()) as FedbRaw[];
  const builtinFedb = new Set(BUILTIN_EXERCISES.map((e) => e.fedb).filter(Boolean));
  // Skip entries already covered by the curated Russian library.
  return raw.filter((r) => !builtinFedb.has(r.id)).map(convertFedb);
}

/** Template made from a single exercise (for "quick start" from the exercise page). */
export function singleExerciseTemplate(ex: Exercise): WorkoutTemplate {
  const d = ex.defaults ?? {};
  return {
    id: uid('w'),
    title: ex.name,
    discipline: ex.disciplines[0],
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    blocks: [
      {
        id: uid('b'),
        title: 'Упражнение',
        kind: 'main',
        rounds: 1,
        items: [
          {
            id: uid('i'),
            exerciseId: ex.id,
            sets: d.sets ?? 3,
            reps: ex.measure === 'reps' ? (d.reps ?? '10') : undefined,
            durationSec: ex.measure !== 'reps' ? d.durationSec : undefined,
            distanceM: d.distanceM,
            restSec: d.restSec ?? 60,
            side: ex.unilateral ? 'each' : undefined,
          },
        ],
      },
    ],
  };
}
