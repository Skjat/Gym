import type { BlockKind, Measure, WorkoutTemplate } from '../types';
import { getExercise, itemName } from '../data/library';

export interface FlatStep {
  key: string;
  blockId: string;
  blockTitle: string;
  blockKind: BlockKind;
  itemId: string;
  exerciseId?: string;
  name: string;
  measure: Measure;
  weighted: boolean;
  round: number;
  rounds: number;
  setIndex: number;
  sets: number;
  reps?: string;
  durationSec?: number;
  distanceM?: number;
  load?: string;
  tempo?: string;
  side?: 'each';
  hrZone?: number;
  notes?: string;
  restAfterSec: number;
}

function defaultRest(kind: BlockKind, measure: Measure, weighted: boolean): number {
  if (kind === 'warmup' || kind === 'cooldown') return measure === 'time' ? 5 : 15;
  if (kind === 'circuit') return 15;
  if (kind === 'interval') return 60;
  if (measure === 'time') return 30;
  return weighted ? 90 : 60;
}

export function flattenWorkout(t: WorkoutTemplate): FlatStep[] {
  const steps: FlatStep[] = [];
  for (const block of t.blocks) {
    const rounds = Math.max(1, block.rounds ?? 1);
    const roundBased = rounds > 1 || block.kind === 'circuit' || block.kind === 'interval';
    const pushItem = (round: number, itemIdx: number) => {
      const item = block.items[itemIdx];
      const ex = getExercise(item.exerciseId);
      const measure: Measure = item.durationSec && !item.reps && !item.distanceM
        ? 'time'
        : item.distanceM && !item.reps
          ? 'distance'
          : item.reps
            ? 'reps'
            : ex?.measure ?? 'reps';
      const weighted = ex?.weighted ?? Boolean(item.load && /кг|%|kg/i.test(item.load));
      const sets = Math.max(1, item.sets ?? 1);
      for (let s = 1; s <= sets; s++) {
        const lastInRound = itemIdx === block.items.length - 1 && s === sets;
        let rest = item.restSec ?? defaultRest(block.kind, measure, weighted);
        if (roundBased && lastInRound && round < rounds) rest = block.restBetweenRoundsSec ?? Math.max(rest, 60);
        if (roundBased && lastInRound && round === rounds) rest = Math.max(item.restSec ?? 0, 30);
        steps.push({
          key: `${block.id}:${round}:${item.id}:${s}`,
          blockId: block.id,
          blockTitle: block.title,
          blockKind: block.kind,
          itemId: item.id,
          exerciseId: item.exerciseId,
          name: itemName(item),
          measure,
          weighted,
          round,
          rounds,
          setIndex: s,
          sets,
          reps: item.reps,
          durationSec: item.durationSec ?? (measure === 'time' ? ex?.defaults?.durationSec ?? 30 : undefined),
          distanceM: item.distanceM,
          load: item.load,
          tempo: item.tempo,
          side: item.side,
          hrZone: item.hrZone ?? ex?.hrZone,
          notes: item.notes,
          restAfterSec: rest,
        });
      }
    };
    if (roundBased) {
      for (let r = 1; r <= rounds; r++) block.items.forEach((_, i) => pushItem(r, i));
    } else {
      block.items.forEach((_, i) => pushItem(1, i));
    }
  }
  // no rest after the very last step
  if (steps.length) steps[steps.length - 1].restAfterSec = 0;
  return steps;
}

/** Leading number from reps like "8-12" → 8, "10" → 10, "макс" → undefined. */
export function repsNumber(reps?: string): number | undefined {
  const m = reps?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

/** Duration of a timed step (both sides for unilateral holds). */
export function stepDuration(step: FlatStep): number {
  const d = step.durationSec ?? 30;
  return step.side === 'each' ? d * 2 : d;
}

export function estimateMinutes(t: WorkoutTemplate): number {
  if (t.estimatedMinutes) return t.estimatedMinutes;
  const steps = flattenWorkout(t);
  let sec = 0;
  for (const s of steps) {
    if (s.measure === 'time') sec += stepDuration(s);
    else if (s.measure === 'distance') sec += (s.distanceM ?? 1000) * 0.36;
    else sec += 40 * (s.side === 'each' ? 2 : 1);
    sec += s.restAfterSec;
  }
  return Math.max(5, Math.round(sec / 60));
}

export function targetText(s: {
  sets?: number;
  reps?: string;
  durationSec?: number;
  distanceM?: number;
  load?: string;
  side?: 'each';
  hrZone?: number;
}): string {
  const parts: string[] = [];
  const sets = s.sets && s.sets > 1 ? `${s.sets} × ` : '';
  if (s.reps) parts.push(`${sets}${s.reps}`);
  else if (s.durationSec) parts.push(`${sets}${s.durationSec >= 60 && s.durationSec % 60 === 0 ? `${s.durationSec / 60} мин` : `${s.durationSec} с`}`);
  else if (s.distanceM) parts.push(`${sets}${s.distanceM >= 1000 ? `${s.distanceM / 1000} км` : `${s.distanceM} м`}`);
  else if (sets) parts.push(`${s.sets} подх.`);
  if (s.side === 'each') parts.push('на каждую сторону');
  if (s.load) parts.push(s.load);
  if (s.hrZone) parts.push(`зона ${s.hrZone}`);
  return parts.join(' · ');
}
