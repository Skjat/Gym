import { Link } from 'react-router-dom';
import type { WorkoutTemplate } from '../types';
import { getExercise, itemName } from '../data/library';
import { BLOCK_KINDS, INTENSITIES, disciplineIcon, tagLabel } from '../data/taxonomy';
import { estimateMinutes, targetText } from '../lib/workoutFlow';
import { ExerciseThumb } from './ExerciseMedia';
import { Icon } from './Icon';

export function WorkoutMeta({ w }: { w: WorkoutTemplate }) {
  return (
    <div className="tags">
      <span className="tag accent">⏱ {estimateMinutes(w)} мин</span>
      {w.discipline && <span className="tag">{disciplineIcon(w.discipline)} {tagLabel('discipline', w.discipline)}</span>}
      {w.location && <span className="tag">{tagLabel('location', w.location)}</span>}
      {w.intensity && <span className={`tag ${w.intensity === 'hard' ? 'red' : w.intensity === 'easy' ? 'green' : 'yellow'}`}>{INTENSITIES[w.intensity]}</span>}
    </div>
  );
}

export function WorkoutView({ w }: { w: WorkoutTemplate }) {
  return (
    <div>
      {w.blocks.map((b) => (
        <div key={b.id}>
          <div className="block-title">
            <span>{b.title || BLOCK_KINDS[b.kind]}</span>
            {(b.rounds ?? 1) > 1 && <span>{b.rounds} кр.{b.restBetweenRoundsSec ? ` · отдых ${b.restBetweenRoundsSec} с` : ''}</span>}
          </div>
          <div className="list">
            {b.items.map((it) => {
              const ex = getExercise(it.exerciseId);
              const inner = (
                <>
                  <ExerciseThumb ex={ex} />
                  <div className="grow">
                    <div className="title">{itemName(it)}</div>
                    <div className="meta">{targetText(it) || '—'}</div>
                    {it.notes && <div className="meta">{it.notes}</div>}
                  </div>
                  {ex && <span className="chev"><Icon name="chevron" size={18} /></span>}
                </>
              );
              return ex ? (
                <Link key={it.id} className="list-item" to={`/exercises/${encodeURIComponent(ex.id)}`}>
                  {inner}
                </Link>
              ) : (
                <div key={it.id} className="list-item">{inner}</div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
