import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Seg, toast, Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { disciplineIcon } from '../data/taxonomy';
import { distance, duration, relativeDay } from '../lib/format';
import { importActivityFile } from '../lib/fileImport';
import { linkSessions } from '../lib/garminLink';

export default function HistoryPage() {
  const [tab, setTab] = useState<'app' | 'garmin'>('app');
  const sessions = useStore((s) => s.sessions);
  const acts = useStore((s) => s.garmin.activities);
  const addImported = useStore((s) => s.addImportedActivities);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let n = 0;
    for (const f of Array.from(files)) {
      try {
        const list = await importActivityFile(f);
        addImported(list);
        n += list.length;
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    linkSessions(useStore.getState().garmin.activities);
    if (n) toast(`Импортировано активностей: ${n}`);
  };

  const weekAgo = Date.now() - 7 * 86400000;
  const week = sessions.filter((s) => new Date(s.startedAt).getTime() > weekAgo);

  return (
    <Page back title="История" sub={`За 7 дней: ${week.length} трен. · ${duration(week.reduce((a, s) => a + (s.metrics?.durationSec ?? 0), 0))}`}>
      <Seg options={[{ id: 'app', label: `Тренировки (${sessions.length})` }, { id: 'garmin', label: `Garmin (${acts.length})` }]} value={tab} onChange={setTab} />
      {tab === 'app' ? (
        sessions.length ? (
          <div className="list">
            {sessions.map((s) => (
              <Link key={s.id} to={`/session/${s.id}`} className="list-item">
                <div className="thumb">{disciplineIcon(s.discipline)}</div>
                <div className="grow">
                  <div className="title ellipsis">{s.title}</div>
                  <div className="meta">
                    {relativeDay(s.startedAt.slice(0, 10))} · {duration(s.metrics?.durationSec)}
                    {s.metrics?.avgHR ? ` · ❤️ ${s.metrics.avgHR}` : ''}
                    {s.rpe ? ` · RPE ${s.rpe}` : ''}
                    {s.garminActivityId ? ' · ⌚' : ''}
                  </div>
                </div>
                <Icon name="chevron" size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <Empty icon="📒" title="Пока нет тренировок" />
        )
      ) : (
        <>
          <div className="btn-row mb">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={18} /> Импорт .fit / .tcx / .gpx
            </button>
            <Link className="btn" to="/garmin">⌚ Синхронизация</Link>
          </div>
          <input ref={fileRef} type="file" multiple accept=".fit,.tcx,.gpx,.zip,application/zip,application/octet-stream,application/xml" hidden onChange={(e) => onFiles(e.target.files)} />
          {acts.length ? (
            <div className="list">
              {acts.map((a) => (
                <Link key={a.id} to={`/activity/${encodeURIComponent(a.id)}`} className="list-item">
                  <div className="thumb">⌚</div>
                  <div className="grow">
                    <div className="title ellipsis">{a.name}</div>
                    <div className="meta">
                      {relativeDay(a.start.slice(0, 10))} · {duration(a.durationSec)}
                      {a.distanceM ? ` · ${distance(a.distanceM)}` : ''}
                      {a.avgHR ? ` · ❤️ ${a.avgHR}` : ''}
                    </div>
                  </div>
                  <Icon name="chevron" size={18} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty icon="⌚" title="Нет активностей Garmin">Настройте синхронизацию или импортируйте файл тренировки.</Empty>
          )}
        </>
      )}
    </Page>
  );
}
