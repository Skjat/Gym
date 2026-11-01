import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { allExercises, downloadFedb, filterExercises, type ExerciseFilter } from '../data/library';
import { useStore } from '../store/store';
import { Chips, Page, Sheet, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { ExerciseThumb } from '../components/ExerciseMedia';
import { DIFFICULTIES, DISCIPLINES, EQUIPMENT, LOCATIONS, MUSCLES, QUALITIES, tagLabel, type Tag } from '../data/taxonomy';

type FilterKey = 'muscle' | 'equipment' | 'quality' | 'difficulty';
const FILTERS: { key: FilterKey; label: string; options: Tag[] }[] = [
  { key: 'muscle', label: 'Мышцы', options: MUSCLES },
  { key: 'equipment', label: 'Инвентарь', options: EQUIPMENT },
  { key: 'quality', label: 'Развивает', options: QUALITIES },
  { key: 'difficulty', label: 'Уровень', options: DIFFICULTIES },
];

export default function ExercisesPage() {
  const [f, setF] = useState<ExerciseFilter>({});
  const [sheet, setSheet] = useState<FilterKey | null>(null);
  const [showFedb, setShowFedb] = useState(false);
  const [loading, setLoading] = useState(false);
  const fedbImported = useStore((s) => s.fedbImported);
  const customCount = useStore((s) => s.customExercises.length);
  const setFedbImported = useStore((s) => s.setFedbImported);

  const list = useMemo(
    () => filterExercises(allExercises(showFedb), f),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, showFedb, fedbImported, customCount],
  );
  const shown = list.slice(0, 300);
  const sheetDef = FILTERS.find((x) => x.key === sheet);

  const importFedb = async () => {
    setLoading(true);
    try {
      const list = await downloadFedb();
      await setFedbImported(list);
      setShowFedb(true);
      toast(`Загружено ${list.length} упражнений`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title="Упражнения" sub={`${list.length} в подборке`}>
      <input className="input mb" type="search" placeholder="Поиск: присед, кобра, plank…" value={f.query ?? ''} onChange={(e) => setF({ ...f, query: e.target.value })} />
      <Chips options={DISCIPLINES} value={f.discipline ?? ''} onChange={(v) => setF({ ...f, discipline: v || undefined })} allLabel="Все" />
      <Chips options={LOCATIONS} value={f.location ?? ''} onChange={(v) => setF({ ...f, location: v || undefined })} allLabel="Где угодно" />
      <div className="chips">
        {FILTERS.map((x) => (
          <button key={x.key} className={`chip ${f[x.key] ? 'on' : 'outline'}`} onClick={() => setSheet(x.key)}>
            {f[x.key] ? tagLabel(x.key === 'difficulty' ? 'difficulty' : x.key, f[x.key]) : x.label} ▾
          </button>
        ))}
        {fedbImported && (
          <button className={`chip ${showFedb ? 'on' : 'outline'}`} onClick={() => setShowFedb(!showFedb)}>
            + база 770 (англ.)
          </button>
        )}
      </div>

      <div className="list">
        {shown.map((e) => (
          <Link key={e.id} to={`/exercises/${encodeURIComponent(e.id)}`} className="list-item">
            <ExerciseThumb ex={e} />
            <div className="grow">
              <div className="title ellipsis">{e.name}</div>
              <div className="meta ellipsis">
                {[...e.primaryMuscles.slice(0, 2).map((m) => tagLabel('muscle', m)), ...e.equipment.filter((q) => q !== 'none').slice(0, 1).map((q) => tagLabel('equipment', q))].join(' · ') || tagLabel('discipline', e.disciplines[0])}
              </div>
            </div>
            {e.source === 'coach' && <span className="tag accent">тренер</span>}
            <Icon name="chevron" size={18} />
          </Link>
        ))}
      </div>
      {list.length > shown.length && <div className="faint center">Показаны первые {shown.length}. Уточните поиск.</div>}
      {!list.length && <div className="empty">Ничего не найдено</div>}

      {!fedbImported && (
        <div className="card mt">
          <h3>Расширенная база упражнений</h3>
          <div className="faint small">Ещё ~770 упражнений с фото из открытой базы free-exercise-db (описания на английском, можно перевести с Claude прямо в карточке).</div>
          <button className="btn block mt" onClick={importFedb} disabled={loading}>{loading ? 'Загрузка…' : 'Загрузить базу'}</button>
        </div>
      )}

      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheetDef?.label}>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          <button className={`chip ${!f[sheet!] ? 'on' : ''}`} onClick={() => { setF({ ...f, [sheet!]: undefined }); setSheet(null); }}>Все</button>
          {sheetDef?.options.map((o) => (
            <button key={o.id} className={`chip ${f[sheet!] === o.id ? 'on' : ''}`} onClick={() => { setF({ ...f, [sheet!]: o.id }); setSheet(null); }}>
              {o.icon ? `${o.icon} ` : ''}{o.label}
            </button>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
