// Validates the bundled exercise library and programs against the vocabularies.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const tax = readFileSync('src/data/taxonomy.ts', 'utf8');
const vocab = (name) => {
  const block = tax.split(`export const ${name}`)[1].split(']);')[0];
  return new Set([...block.matchAll(/\['([a-z_]+)'/g)].map((m) => m[1]));
};
const V = {
  disciplines: vocab('DISCIPLINES'),
  locations: vocab('LOCATIONS'),
  muscles: vocab('MUSCLES'),
  equipment: vocab('EQUIPMENT'),
  qualities: vocab('QUALITIES'),
  difficulty: vocab('DIFFICULTIES'),
};
const errors = [];
const err = (m) => errors.push(m);

const exercises = readdirSync('src/data/exercises')
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join('src/data/exercises', f), 'utf8')).map((e) => ({ ...e, _file: f })));
const ids = new Set();
for (const e of exercises) {
  const where = `${e._file}:${e.id}`;
  if (ids.has(e.id)) err(`duplicate id ${where}`);
  ids.add(e.id);
  for (const f of ['name', 'description', 'measure', 'difficulty']) if (!e[f]) err(`${where} missing ${f}`);
  if (!Array.isArray(e.steps) || !e.steps.length) err(`${where} no steps`);
  for (const d of e.disciplines ?? []) if (!V.disciplines.has(d)) err(`${where} bad discipline ${d}`);
  for (const d of e.locations ?? []) if (!V.locations.has(d)) err(`${where} bad location ${d}`);
  for (const d of [...(e.primaryMuscles ?? []), ...(e.secondaryMuscles ?? [])]) if (!V.muscles.has(d)) err(`${where} bad muscle ${d}`);
  for (const d of e.equipment ?? []) if (!V.equipment.has(d)) err(`${where} bad equipment ${d}`);
  for (const d of e.qualities ?? []) if (!V.qualities.has(d)) err(`${where} bad quality ${d}`);
  if (!V.difficulty.has(e.difficulty)) err(`${where} bad difficulty ${e.difficulty}`);
  if (!['reps', 'time', 'distance'].includes(e.measure)) err(`${where} bad measure ${e.measure}`);
}

const programs = readdirSync('src/data/programs')
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join('src/data/programs', f), 'utf8')));
const wids = new Set();
let workouts = 0;
for (const p of programs) {
  if (!V.disciplines.has(p.discipline)) err(`program ${p.id} bad discipline ${p.discipline}`);
  for (const l of p.locations) if (!V.locations.has(l)) err(`program ${p.id} bad location ${l}`);
  for (const w of p.workouts) {
    workouts++;
    if (wids.has(w.id)) err(`duplicate workout id ${w.id}`);
    wids.add(w.id);
    for (const b of w.blocks) {
      if (!['warmup', 'main', 'circuit', 'interval', 'cooldown'].includes(b.kind)) err(`${w.id} bad kind ${b.kind}`);
      for (const it of b.items) {
        if (!ids.has(it.exerciseId)) err(`${w.id} unknown exercise ${it.exerciseId}`);
        if (!it.reps && !it.durationSec && !it.distanceM) err(`${w.id} ${it.exerciseId} has no target`);
      }
    }
  }
}

const withPhotos = exercises.filter((e) => e.fedb).length;
console.log(`exercises: ${exercises.length} (${withPhotos} with photos), programs: ${programs.length}, workouts: ${workouts}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('OK');
