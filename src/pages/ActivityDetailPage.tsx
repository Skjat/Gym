import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Stat, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { HRChart, LineChart, ZoneBars } from '../components/Charts';
import { distance, duration, humanDateTime, pace, speedToPace } from '../lib/format';
import { zoneBounds, zoneSeconds } from '../lib/hr';
import { chatForToday } from '../coach/flows';
import type { HRSample } from '../types';

export default function ActivityDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const decoded = id ? decodeURIComponent(id) : '';
  const a = useStore((s) => s.garmin.activities.find((x) => x.id === decoded));
  const profile = useStore((s) => s.profile);
  const garminRest = useStore((s) => [...s.garmin.daily].sort((x, y) => y.date.localeCompare(x.date))[0]?.restingHR);
  const session = useStore((s) => s.sessions.find((x) => x.garminActivityId === decoded));
  const [showSets, setShowSets] = useState(false);
  const bounds = useMemo(() => zoneBounds(profile, garminRest), [profile, garminRest]);
  if (!a) return <Page back title="Активность не найдена">{null}</Page>;
  const hr: HRSample[] = (a.series ?? []).filter((p) => p[1]).map((p) => ({ t: p[0], bpm: p[1] as number }));
  const zs = a.zoneSec ?? (hr.length ? zoneSeconds(hr, bounds).map(Math.round) : undefined);
  const paces = (a.series ?? []).map((p) => (p[2] && p[2] > 0.8 ? 1000 / p[2] : null));
  const isRun = /run|бег|walk|hik/i.test(a.type) && (a.distanceM ?? 0) > 500;

  const discuss = () => {
    nav(`/coach/${chatForToday().id}`, {
      state: { autoSend: `Разбери мою активность Garmin «${a.name}» (activityId ${a.id}): пульс, темп, Training Effect. Что получилось и что поправить в плане?` },
    });
  };

  return (
    <Page back title={a.name} sub={`${humanDateTime(a.startGMT ?? a.start)} · ${a.source === 'file' ? 'из файла' : 'Garmin Connect'}`}>
      <div className="stats mb">
        <Stat v={duration(a.durationSec)} l="Время" />
        {a.distanceM ? <Stat v={distance(a.distanceM)} l="Дистанция" /> : null}
        {isRun && a.avgSpeed ? <Stat v={pace(speedToPace(a.avgSpeed))} l="Средний темп" /> : null}
        {a.avgHR ? <Stat v={a.avgHR} l="Пульс средний" /> : null}
        {a.maxHR ? <Stat v={a.maxHR} l="Пульс макс" /> : null}
        {a.aerobicTE ? <Stat v={a.aerobicTE.toFixed(1)} l="TE аэробный" /> : null}
        {a.anaerobicTE ? <Stat v={a.anaerobicTE.toFixed(1)} l="TE анаэробный" /> : null}
        {a.trainingLoad ? <Stat v={Math.round(a.trainingLoad)} l="Нагрузка" /> : null}
        {a.avgCadence ? <Stat v={Math.round(a.avgCadence)} l="Каденс" /> : null}
        {a.elevationGain ? <Stat v={`${Math.round(a.elevationGain)} м`} l="Набор высоты" /> : null}
        {a.calories ? <Stat v={a.calories} l="ккал" /> : null}
      </div>
      <button className="btn primary block mb" onClick={discuss}><Icon name="sparkle" size={18} /> Разбор с тренером</button>
      {session && <button className="btn block mb" onClick={() => nav(`/session/${session.id}`)}>Тренировка в приложении: {session.title}</button>}

      {hr.length > 1 && (
        <div className="card">
          <h2>Пульс</h2>
          <HRChart samples={hr} bounds={bounds} />
          {zs && <div className="mt"><ZoneBars zoneSec={zs} bounds={bounds} /></div>}
        </div>
      )}
      {isRun && paces.some(Boolean) && (
        <div className="card">
          <h2>Темп</h2>
          <LineChart values={paces} invert />
        </div>
      )}
      {!!a.laps?.length && (
        <div className="card">
          <h2>Круги / отрезки</h2>
          {a.laps.map((l) => (
            <div key={l.index} className="row between small" style={{ padding: '4px 0', borderBottom: '0.5px solid var(--sep)' }}>
              <span>#{l.index}</span>
              <span>{l.distanceM ? distance(l.distanceM) : ''}</span>
              <span>{duration(l.durationSec)}</span>
              <span>{l.avgSpeed && isRun ? pace(speedToPace(l.avgSpeed)) : ''}</span>
              <span>{l.avgHR ? `♥${l.avgHR}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {!!a.sets?.length && (
        <div className="card">
          <div className="row between" onClick={() => setShowSets(!showSets)}>
            <h2 style={{ margin: 0 }}>Подходы (часы): {a.sets.length}</h2>
            <Icon name={showSets ? 'close' : 'chevron'} size={18} />
          </div>
          {showSets && a.sets.map((x, i) => (
            <div key={i} className="small" style={{ padding: '3px 0' }}>
              {x.exercise ?? x.category ?? 'Подход'}: {x.weightKg ? `${x.weightKg} кг × ` : ''}{x.reps ?? '—'} {x.durationSec ? `(${x.durationSec} с)` : ''}
            </div>
          ))}
        </div>
      )}
      {a.source === 'file' && (
        <button className="btn danger block" onClick={() => {
          const st = useStore.getState();
          st.setGarmin({ ...st.garmin, activities: st.garmin.activities.filter((x) => x.id !== a.id) });
          toast('Удалено');
          nav(-1);
        }}>Удалить импорт</button>
      )}
    </Page>
  );
}
