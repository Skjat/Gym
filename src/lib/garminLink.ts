import type { GarminActivity, GarminData, WorkoutSession } from '../types';
import { useStore } from '../store/store';
import { annotateSetsHR, computeMetrics, hrFromActivity, matchActivity } from './session';
import { fetchGarminData } from './garminSync';

/** Link app sessions to Garmin activities recorded at the same time; borrow HR when the app had none. */
export function linkSessions(acts: GarminActivity[]) {
  const st = useStore.getState();
  const rest = [...st.garmin.daily].sort((a, b) => b.date.localeCompare(a.date))[0]?.restingHR;
  for (const s of st.sessions) {
    if (s.garminActivityId && acts.every((a) => a.id !== s.garminActivityId)) continue;
    const a = s.garminActivityId ? acts.find((x) => x.id === s.garminActivityId) : matchActivity(s, acts);
    if (!a) continue;
    let next: WorkoutSession = { ...s, garminActivityId: a.id };
    if (!s.hr.length && a.series?.length) {
      next = annotateSetsHR({ ...next, hr: hrFromActivity(s, a), hrSource: 'garmin' });
      next.metrics = { ...computeMetrics(next, st.profile, rest), distanceM: s.metrics?.distanceM ?? a.distanceM, calories: a.calories };
    } else if (!s.garminActivityId) {
      next.metrics = { ...(s.metrics ?? computeMetrics(next, st.profile, rest)), calories: a.calories };
    } else continue;
    st.saveSession(next);
  }
}

export function applyGarminData(data: GarminData) {
  useStore.getState().setGarmin(data);
  linkSessions(useStore.getState().garmin.activities);
}

export async function refreshGarmin(): Promise<GarminData> {
  const data = await fetchGarminData(useStore.getState().settings);
  applyGarminData(data);
  return data;
}
