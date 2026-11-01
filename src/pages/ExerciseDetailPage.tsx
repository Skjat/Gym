import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { exerciseOrigin, getExercise, singleExerciseTemplate } from '../data/library';
import { OriginTag, Page, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { ExerciseMedia } from '../components/ExerciseMedia';
import { QUALITIES, tagLabel, disciplineIcon } from '../data/taxonomy';
import { useStore } from '../store/store';
import { startWorkout } from '../lib/player';
import { chatForToday } from '../coach/flows';
import { friendlyError, translateExercise } from '../coach/claude';
import { humanDate, humanDateTime } from '../lib/format';
import { targetText } from '../lib/workoutFlow';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export default function ExerciseDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const sessions = useStore((s) => s.sessions);
  const upsertCustomExercise = useStore((s) => s.upsertCustomExercise);
  const removeCustomExercise = useStore((s) => s.removeCustomExercise);
  useStore((s) => s.customExercises); // re-render after translation
  const [busy, setBusy] = useState(false);
  const ex = getExercise(id ? decodeURIComponent(id) : undefined);
  if (!ex) return <Page back title="Упражнение не найдено">{null}</Page>;

  const origin = exerciseOrigin(ex.id);
  const revert = () => {
    if (!confirm(origin === 'edited' ? 'Вернуть исходное описание упражнения?' : 'Удалить упражнение из библиотеки?')) return;
    removeCustomExercise(ex.id);
    toast(origin === 'edited' ? 'Восстановлено исходное упражнение' : 'Упражнение удалено');
    if (origin === 'custom') nav(-1);
  };

  const history = sessions
    .map((s) => ({ s, sets: s.sets.filter((x) => x.exerciseId === ex.id && !x.skipped) }))
    .filter((x) => x.sets.length)
    .slice(0, 6);

  const translate = async () => {
    setBusy(true);
    try {
      const t = await translateExercise(ex);
      upsertCustomExercise({ ...t, source: 'fedb' });
      toast('Описание переведено');
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page back title={ex.name} sub={[ex.sanskrit, ex.nameEn !== ex.name ? ex.nameEn : undefined].filter(Boolean).join(' · ')}>
      {(origin === 'custom' || origin === 'edited') && (
        <div className="card row" style={{ boxShadow: 'inset 0 0 0 1.5px var(--blue)' }}>
          <div className="grow small">
            {origin === 'custom' ? '✨ Упражнение создано тренером' : '✎ Встроенное упражнение изменено тренером'}
            {ex.updatedAt && <div className="faint">{humanDateTime(ex.updatedAt)}</div>}
          </div>
          <button className="btn small danger" onClick={revert}>{origin === 'edited' ? 'Вернуть оригинал' : 'Удалить'}</button>
        </div>
      )}
      <ExerciseMedia ex={ex} />

      <div className="card">
        <div className="tags">
          <OriginTag origin={origin} />
          {ex.disciplines.map((d) => <span key={d} className="tag accent">{disciplineIcon(d)} {tagLabel('discipline', d)}</span>)}
          <span className="tag">{tagLabel('difficulty', ex.difficulty)}</span>
          {ex.locations.map((l) => <span key={l} className="tag">{tagLabel('location', l)}</span>)}
        </div>
        {!!ex.primaryMuscles.length && (
          <div className="mt">
            <div className="faint small">Основные мышцы</div>
            <div className="tags">{ex.primaryMuscles.map((m) => <span key={m} className="tag red">{tagLabel('muscle', m)}</span>)}</div>
          </div>
        )}
        {!!ex.secondaryMuscles.length && (
          <div className="mt">
            <div className="faint small">Вспомогательные</div>
            <div className="tags">{ex.secondaryMuscles.map((m) => <span key={m} className="tag yellow">{tagLabel('muscle', m)}</span>)}</div>
          </div>
        )}
        {!!ex.qualities.length && (
          <div className="mt">
            <div className="faint small">Развивает</div>
            <div className="tags">{ex.qualities.map((q) => <span key={q} className="tag blue">{QUALITIES.find((x) => x.id === q)?.icon} {tagLabel('quality', q)}</span>)}</div>
          </div>
        )}
        {!!ex.equipment.length && (
          <div className="mt">
            <div className="faint small">Инвентарь</div>
            <div className="tags">{ex.equipment.map((q) => <span key={q} className="tag">{tagLabel('equipment', q)}</span>)}</div>
          </div>
        )}
        {ex.defaults && <div className="faint small mt">По умолчанию: {targetText(ex.defaults)}{ex.defaults.restSec ? ` · отдых ${ex.defaults.restSec} с` : ''}</div>}
        <div className="btn-row mt">
          <button className="btn primary" onClick={() => startWorkout(singleExerciseTemplate(ex)) && nav('/player')}>
            <Icon name="play" fill size={18} /> Выполнить
          </button>
          <button className="btn" onClick={() => nav(`/coach/${chatForToday().id}`, { state: { autoSend: `Расскажи подробнее про технику упражнения «${ex.name}» (id ${ex.id}) с учётом моих особенностей. На что обратить внимание?` } })}>
            <Icon name="sparkle" size={18} /> Спросить
          </button>
        </div>
        <button className="btn block mt" onClick={() => nav(`/coach/${chatForToday().id}`, { state: { prefill: `Измени упражнение «${ex.name}» (exerciseId ${ex.id}): ` } })}>
          <Icon name="edit" size={18} /> Изменить с тренером
        </button>
        {ex.source === 'fedb' && /английском/.test(ex.description) && (
          <button className="btn block mt" onClick={translate} disabled={busy}>{busy ? 'Перевожу…' : 'Перевести с Claude'}</button>
        )}
      </div>

      <Section title="Описание"><p style={{ margin: 0 }}>{ex.description}</p></Section>
      {!!ex.steps.length && (
        <Section title="Техника">
          <ol className="steps">{ex.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </Section>
      )}
      {!!ex.tips?.length && (
        <Section title="Советы">
          <ul className="steps">{ex.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {!!ex.mistakes?.length && (
        <Section title="Частые ошибки">
          <ul className="steps">{ex.mistakes.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {ex.breathing && <Section title="Дыхание"><p style={{ margin: 0 }}>{ex.breathing}</p></Section>}
      {!!ex.variations?.length && (
        <Section title="Варианты">
          <ul className="steps">{ex.variations.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {ex.contraindications && (
        <div className="card" style={{ border: '1px solid rgba(239,68,68,0.4)' }}>
          <h2>⚠️ Ограничения</h2>
          <p style={{ margin: 0 }}>{ex.contraindications}</p>
        </div>
      )}
      {history.length > 0 && (
        <Section title="Мои результаты">
          {history.map(({ s, sets }) => (
            <div key={s.id} className="row between small" style={{ padding: '4px 0' }}>
              <span className="faint">{humanDate(s.startedAt)}</span>
              <span>{sets.map((x) => [x.weightKg ? `${x.weightKg}кг` : '', x.reps ? `×${x.reps}` : '', x.durationSec && !x.reps ? `${x.durationSec}с` : ''].join('')).join(', ')}</span>
            </div>
          ))}
        </Section>
      )}
      {ex.fedb && <div className="faint small center">Фото: free-exercise-db (public domain)</div>}
    </Page>
  );
}
