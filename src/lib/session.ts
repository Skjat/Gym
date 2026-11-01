import type { AthleteProfile, GarminActivity, HRSample, SessionMetrics, WorkoutSession } from '../types';
import { effectiveMaxHR, effectiveRestHR, hrStats, samplesBetween, trimp, zoneBounds, zoneSeconds } from './hr';

export function computeMetrics(s: WorkoutSession, profile: AthleteProfile, garminRest?: number, distanceM?: number, rmssd?: number): SessionMetrics {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  const durationSec = Math.round((end - start) / 1000);
  const st = hrStats(s.hr);
  const bounds = zoneBounds(profile, garminRest);
  const done = s.sets.filter((x) => !x.skipped);
  const volume = done.reduce((a, x) => a + (x.weightKg ?? 0) * (x.reps ?? 0), 0);
  const activeSec = done.reduce((a, x) => a + Math.max(0, x.endedAt - x.startedAt), 0);
  const runDistance = distanceM ?? (done.reduce((a, x) => a + (x.distanceM ?? 0), 0) || undefined);
  const runSec = done.filter((x) => x.distanceM).reduce((a, x) => a + (x.endedAt - x.startedAt), 0);
  return {
    durationSec,
    activeSec: Math.round(activeSec),
    avgHR: st.avg,
    maxHR: st.max,
    minHR: st.min,
    zoneSec: s.hr.length ? zoneSeconds(s.hr, bounds).map(Math.round) : undefined,
    trimp: s.hr.length ? trimp(s.hr, effectiveRestHR(profile, garminRest), effectiveMaxHR(profile), profile.sex === 'female') : undefined,
    distanceM: runDistance ? Math.round(runDistance) : undefined,
    avgPaceSecPerKm: runDistance && runSec ? Math.round(runSec / (runDistance / 1000)) : undefined,
    rmssd,
    totalVolumeKg: volume ? Math.round(volume) : undefined,
    setsDone: done.length,
  };
}

/** Fill per-set heart rate from the session samples. */
export function annotateSetsHR(s: WorkoutSession): WorkoutSession {
  if (!s.hr.length) return s;
  return {
    ...s,
    sets: s.sets.map((x) => {
      const st = hrStats(samplesBetween(s.hr, x.startedAt, x.endedAt + 5));
      return { ...x, avgHR: st.avg, maxHR: st.max };
    }),
  };
}

/** The Garmin activity recorded during this session (by time overlap). */
export function matchActivity(s: WorkoutSession, acts: GarminActivity[]): GarminActivity | undefined {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : start + 3600_000;
  let best: GarminActivity | undefined;
  let bestOverlap = 0;
  for (const a of acts) {
    const aStart = a.startGMT ? new Date(a.startGMT).getTime() : new Date(a.start).getTime();
    const aEnd = aStart + a.durationSec * 1000;
    const overlap = Math.min(end, aEnd) - Math.max(start, aStart);
    if (overlap > bestOverlap && overlap > 0.3 * Math.min(end - start, aEnd - aStart)) {
      best = a;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** HR samples from a Garmin activity, aligned to the session's start. */
export function hrFromActivity(s: WorkoutSession, a: GarminActivity): HRSample[] {
  const start = new Date(s.startedAt).getTime();
  const aStart = a.startGMT ? new Date(a.startGMT).getTime() : new Date(a.start).getTime();
  const shift = (aStart - start) / 1000;
  return (a.series ?? [])
    .filter((p) => p[1])
    .map((p) => ({ t: Math.round(p[0] + shift), bpm: p[1] as number }))
    .filter((p) => p.t >= 0);
}

export function sessionSummaryText(s: WorkoutSession): string {
  const m = s.metrics;
  const lines = [
    `Тренировка «${s.title}» [id ${s.id}], ${s.startedAt.slice(0, 16).replace('T', ' ')}`,
    m && `Длительность ${Math.round(m.durationSec / 60)} мин, подходов ${m.setsDone}${m.totalVolumeKg ? `, объём ${m.totalVolumeKg} кг` : ''}${m.distanceM ? `, дистанция ${m.distanceM} м` : ''}`,
    m?.avgHR && `Пульс: средний ${m.avgHR}, макс ${m.maxHR}, TRIMP ${m.trimp ?? '—'}${m.zoneSec ? `, время в зонах Z1–Z5 (сек): ${m.zoneSec.join('/')}` : ''}`,
    s.rpe && `RPE (субъективная тяжесть): ${s.rpe}/10`,
    s.feeling && `Самочувствие: ${s.feeling}`,
    s.notes && `Заметки: ${s.notes}`,
    s.garminActivityId && `Связанная активность Garmin: ${s.garminActivityId}`,
  ].filter(Boolean);
  return lines.join('\n');
}
