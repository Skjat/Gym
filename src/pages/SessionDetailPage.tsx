import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Stat, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { HRChart, ZoneBars } from '../components/Charts';
import { Markdown } from '../components/Markdown';
import { clock, distance, duration, humanDateTime, pace } from '../lib/format';
import { zoneBounds } from '../lib/hr';
import { analyzeSession } from '../coach/flows';
import { friendlyError } from '../coach/claude';
import { startWorkout } from '../lib/player';
import { activityLine } from '../coach/context';
import type { SetLog } from '../types';

export default function SessionDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useStore((st) => st.sessions.find((x) => x.id === id));
  const profile = useStore((st) => st.profile);
  const acts = useStore((st) => st.garmin.activities);
  const garminRest = useStore((st) => [...st.garmin.daily].sort((a, b) => b.date.localeCompare(a.date))[0]?.restingHR);
  const conv = useStore((st) => st.conversations.find((c) => c.kind === 'analysis' && c.sessionId === id));
  const deleteSession = useStore((st) => st.deleteSession);
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [status, setStatus] = useState('');
  const bounds = useMemo(() => zoneBounds(profile, garminRest), [profile, garminRest]);
  if (!s) return <Page back title="Тренировка не найдена">{null}</Page>;
  const m = s.metrics;
  const act = acts.find((a) => a.id === s.garminActivityId);

  const groups = new Map<string, SetLog[]>();
  for (const x of s.sets) {
    const k = x.exerciseName;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }

  const analyze = async () => {
    setBusy(true);
    setStream('');
    try {
      await analyzeSession(s.id, { onText: setStream, onStatus: setStatus });
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
      setStream('');
    }
  };

  return (
    <Page back title={s.title} sub={humanDateTime(s.startedAt)}>
      <div className="stats mb">
        <Stat v={duration(m?.durationSec)} l="Длительность" />
        <Stat v={m?.setsDone ?? s.sets.length} l="Подходов" />
        {m?.totalVolumeKg ? <Stat v={`${m.totalVolumeKg} кг`} l="Объём" /> : null}
        {m?.distanceM ? <Stat v={distance(m.distanceM)} l="Дистанция" /> : null}
        {m?.avgPaceSecPerKm ? <Stat v={pace(m.avgPaceSecPerKm)} l="Темп" /> : null}
        {m?.avgHR ? <Stat v={m.avgHR} l="Пульс средний" /> : null}
        {m?.maxHR ? <Stat v={m.maxHR} l="Пульс макс" /> : null}
        {m?.trimp ? <Stat v={m.trimp} l="TRIMP" /> : null}
        {m?.calories ? <Stat v={m.calories} l="ккал (Garmin)" /> : null}
        {s.rpe ? <Stat v={`${s.rpe}/10`} l="RPE" /> : null}
      </div>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Разбор тренера</h2>
          {conv && <Link to={`/coach/${conv.id}`} className="small">Обсудить →</Link>}
        </div>
        {busy ? (
          <div className="mt">
            {stream ? <Markdown text={stream} /> : <span className="typing"><i /><i /><i /></span>} <span className="faint small">{status}</span>
          </div>
        ) : s.analysis ? (
          <div className="mt"><Markdown text={s.analysis} /></div>
        ) : (
          <div className="faint small mt">Тренер посмотрит пульс, подходы, данные Garmin и самочувствие, сравнит с прошлыми тренировками и при необходимости поправит план.</div>
        )}
        {!busy && (
          <button className="btn primary block mt" onClick={analyze}>
            <Icon name="sparkle" size={18} /> {s.analysis ? 'Разобрать заново' : 'Разбор от тренера'}
          </button>
        )}
      </div>

      {s.hr.length > 1 && (
        <div className="card">
          <h2>Пульс</h2>
          <HRChart samples={s.hr} bounds={bounds} />
          {m?.zoneSec && <div className="mt"><ZoneBars zoneSec={m.zoneSec} bounds={bounds} /></div>}
          <div className="faint small mt">Источник: {s.hrSource === 'ble' ? 'Bluetooth (живой пульс)' : s.hrSource === 'garmin' ? 'Garmin' : '—'}{m?.rmssd ? ` · RMSSD ${m.rmssd} мс` : ''}</div>
        </div>
      )}

      <div className="card">
        <h2>Garmin</h2>
        {act ? (
          <Link to={`/activity/${encodeURIComponent(act.id)}`} className="small">{activityLine(act)} →</Link>
        ) : (
          <div className="faint small">Активность с часов пока не найдена. После синхронизации Garmin она привяжется автоматически (по времени), и тренер увидит пульс и Training Effect.</div>
        )}
      </div>

      <div className="card">
        <h2>Подходы</h2>
        {[...groups.entries()].map(([name, sets]) => (
          <div key={name} style={{ padding: '6px 0', borderBottom: '0.5px solid var(--sep)' }}>
            <div style={{ fontWeight: 600 }}>{name}</div>
            <div className="small muted">
              {sets.map((x, i) => (
                <span key={x.id}>
                  {i > 0 && ', '}
                  {x.skipped ? <s>пропуск</s> : [x.weightKg ? `${x.weightKg}кг` : '', x.reps ? `×${x.reps}` : '', x.durationSec && !x.reps ? clock(x.durationSec) : '', x.distanceM ? ` ${distance(x.distanceM)}` : ''].join('')}
                  {x.avgHR ? <span className="faint"> (♥{x.avgHR})</span> : null}
                </span>
              ))}
            </div>
          </div>
        ))}
        {!s.sets.length && <div className="faint">Подходы не записаны</div>}
      </div>

      {(s.feeling || s.notes) && (
        <div className="card">
          <h2>Самочувствие</h2>
          {s.feeling && <div>{s.feeling}</div>}
          {s.notes && <div className="muted small mt">{s.notes}</div>}
        </div>
      )}

      {s.tips.length > 0 && (
        <div className="card">
          <h2>Подсказки во время тренировки</h2>
          {s.tips.map((t, i) => (
            <div key={i} className="small" style={{ padding: '3px 0' }}>
              <span className="faint">{clock(t.t)} · {t.source === 'user' ? 'вы' : t.source === 'zone' ? 'пульс' : 'тренер'}:</span> {t.text}
            </div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => startWorkout({ ...s.template }) && nav('/player')}>Повторить</button>
        <button className="btn danger" onClick={() => { if (confirm('Удалить тренировку из истории?')) { deleteSession(s.id); nav(-1); } }}>Удалить</button>
      </div>
    </Page>
  );
}
