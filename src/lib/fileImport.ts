// Import Garmin activities from files: .fit (original), .tcx, .gpx or .zip ("Export Original").
import { unzipSync } from 'fflate';
import type { GarminActivity, GarminExerciseSet, GarminLap } from '../types';
import { haversine } from './geo';

type Point = { t: number; hr?: number; speed?: number; cad?: number; dist?: number; lat?: number; lon?: number };

function buildSeries(points: Point[]): GarminActivity['series'] {
  if (!points.length) return [];
  const t0 = points[0].t;
  const out: NonNullable<GarminActivity['series']> = [];
  let lastT = -Infinity;
  for (const p of points) {
    const t = Math.round((p.t - t0) / 1000);
    if (t - lastT < 5) continue; // ~5 s resolution
    lastT = t;
    out.push([t, p.hr ?? null, p.speed != null ? Math.round(p.speed * 100) / 100 : null, p.cad ?? null]);
  }
  return out;
}

function summarize(points: Point[]) {
  const hrs = points.map((p) => p.hr).filter((x): x is number => !!x);
  const avgHR = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined;
  const maxHR = hrs.length ? Math.max(...hrs) : undefined;
  let dist = points.length ? points[points.length - 1].dist : undefined;
  if (dist == null) {
    dist = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) dist += haversine({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
    }
  }
  const durationSec = points.length > 1 ? Math.round((points[points.length - 1].t - points[0].t) / 1000) : 0;
  return { avgHR, maxHR, distanceM: dist ? Math.round(dist) : undefined, durationSec };
}

function localISO(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 19);
}

// ───────────── TCX ─────────────
function parseTCX(text: string, fileName: string): GarminActivity[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const acts = [...doc.getElementsByTagNameNS('*', 'Activity')];
  return acts.map((act, ai) => {
    const sport = act.getAttribute('Sport') ?? 'Other';
    const points: Point[] = [];
    const laps: GarminLap[] = [];
    let calories = 0;
    [...act.getElementsByTagNameNS('*', 'Lap')].forEach((lap, li) => {
      const num = (tag: string) => {
        const el = [...lap.children].find((c) => c.localName === tag);
        return el ? Number(el.textContent) : undefined;
      };
      const avgHrEl = [...lap.children].find((c) => c.localName === 'AverageHeartRateBpm');
      const maxHrEl = [...lap.children].find((c) => c.localName === 'MaximumHeartRateBpm');
      calories += num('Calories') ?? 0;
      laps.push({
        index: li + 1,
        durationSec: num('TotalTimeSeconds'),
        distanceM: num('DistanceMeters'),
        avgHR: avgHrEl ? Number(avgHrEl.textContent) : undefined,
        maxHR: maxHrEl ? Number(maxHrEl.textContent) : undefined,
      });
      for (const tp of lap.getElementsByTagNameNS('*', 'Trackpoint')) {
        const get = (tag: string) => tp.getElementsByTagNameNS('*', tag)[0]?.textContent ?? undefined;
        const time = get('Time');
        if (!time) continue;
        const p: Point = { t: new Date(time).getTime() };
        const hr = get('Value');
        if (hr) p.hr = Number(hr);
        const d = get('DistanceMeters');
        if (d) p.dist = Number(d);
        const sp = get('Speed');
        if (sp) p.speed = Number(sp);
        const cad = get('RunCadence') ?? get('Cadence');
        if (cad) p.cad = Number(cad);
        const lat = get('LatitudeDegrees');
        const lon = get('LongitudeDegrees');
        if (lat && lon) {
          p.lat = Number(lat);
          p.lon = Number(lon);
        }
        points.push(p);
      }
    });
    const id = act.getElementsByTagNameNS('*', 'Id')[0]?.textContent ?? `${fileName}-${ai}`;
    const start = points[0] ? new Date(points[0].t) : new Date(id);
    const s = summarize(points);
    return {
      id: `file:${id}`,
      name: `${sport} (${fileName})`,
      type: sport.toLowerCase(),
      start: localISO(start),
      startGMT: start.toISOString(),
      durationSec: laps.reduce((a, l) => a + (l.durationSec ?? 0), 0) || s.durationSec,
      distanceM: s.distanceM,
      avgHR: s.avgHR,
      maxHR: s.maxHR,
      calories: calories || undefined,
      laps,
      series: buildSeries(points),
      source: 'file' as const,
    };
  });
}

// ───────────── GPX ─────────────
function parseGPX(text: string, fileName: string): GarminActivity[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const points: Point[] = [];
  for (const pt of doc.getElementsByTagNameNS('*', 'trkpt')) {
    const time = pt.getElementsByTagNameNS('*', 'time')[0]?.textContent;
    if (!time) continue;
    const p: Point = { t: new Date(time).getTime(), lat: Number(pt.getAttribute('lat')), lon: Number(pt.getAttribute('lon')) };
    const hr = pt.getElementsByTagNameNS('*', 'hr')[0]?.textContent;
    if (hr) p.hr = Number(hr);
    const cad = pt.getElementsByTagNameNS('*', 'cad')[0]?.textContent;
    if (cad) p.cad = Number(cad);
    points.push(p);
  }
  if (!points.length) return [];
  // speed from consecutive points
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = (b.t - a.t) / 1000;
    if (dt > 0) b.speed = haversine({ lat: a.lat!, lon: a.lon! }, { lat: b.lat!, lon: b.lon! }) / dt;
  }
  const name = doc.getElementsByTagNameNS('*', 'name')[0]?.textContent ?? fileName;
  const type = doc.getElementsByTagNameNS('*', 'type')[0]?.textContent ?? 'running';
  const s = summarize(points);
  const start = new Date(points[0].t);
  return [
    {
      id: `file:gpx:${points[0].t}`,
      name,
      type,
      start: localISO(start),
      startGMT: start.toISOString(),
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      avgHR: s.avgHR,
      maxHR: s.maxHR,
      series: buildSeries(points),
      source: 'file',
    },
  ];
}

// ───────────── FIT ─────────────
async function parseFIT(bytes: Uint8Array, fileName: string): Promise<GarminActivity[]> {
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error('Файл не похож на FIT');
  const { messages } = decoder.read({ convertDateTimesToDates: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = messages as Record<string, any[]>;
  const records = m.recordMesgs ?? [];
  const points: Point[] = records
    .filter((r) => r.timestamp)
    .map((r) => ({
      t: new Date(r.timestamp).getTime(),
      hr: r.heartRate,
      speed: r.enhancedSpeed ?? r.speed,
      cad: r.cadence,
      dist: r.distance,
      lat: r.positionLat != null ? (r.positionLat * 180) / 2 ** 31 : undefined,
      lon: r.positionLong != null ? (r.positionLong * 180) / 2 ** 31 : undefined,
    }));
  const session = (m.sessionMesgs ?? [])[0] ?? {};
  const laps: GarminLap[] = (m.lapMesgs ?? []).map((l, i) => ({
    index: i + 1,
    durationSec: l.totalTimerTime != null ? Math.round(l.totalTimerTime) : undefined,
    distanceM: l.totalDistance != null ? Math.round(l.totalDistance) : undefined,
    avgHR: l.avgHeartRate,
    maxHR: l.maxHeartRate,
    avgSpeed: l.enhancedAvgSpeed ?? l.avgSpeed,
    avgCadence: l.avgRunningCadence ?? l.avgCadence,
  }));
  const sets: GarminExerciseSet[] = (m.setMesgs ?? [])
    .filter((s) => s.setType === 'active' || s.setType === 1)
    .map((s) => ({
      category: Array.isArray(s.category) ? String(s.category[0]) : s.category != null ? String(s.category) : undefined,
      reps: s.repetitions,
      weightKg: s.weight,
      durationSec: s.duration != null ? Math.round(s.duration) : undefined,
      startTime: s.startTime ? new Date(s.startTime).toISOString() : undefined,
    }));
  const summary = summarize(points);
  const start = session.startTime ? new Date(session.startTime) : points[0] ? new Date(points[0].t) : new Date();
  const sport = String(session.sport ?? 'activity');
  return [
    {
      id: `file:fit:${start.getTime()}`,
      name: `${sport}${session.subSport && session.subSport !== 'generic' ? ` / ${session.subSport}` : ''} (${fileName})`,
      type: sport,
      start: localISO(start),
      startGMT: start.toISOString(),
      durationSec: Math.round(session.totalElapsedTime ?? summary.durationSec),
      movingSec: session.totalTimerTime != null ? Math.round(session.totalTimerTime) : undefined,
      distanceM: session.totalDistance != null ? Math.round(session.totalDistance) : summary.distanceM,
      avgHR: session.avgHeartRate ?? summary.avgHR,
      maxHR: session.maxHeartRate ?? summary.maxHR,
      calories: session.totalCalories,
      avgSpeed: session.enhancedAvgSpeed ?? session.avgSpeed,
      maxSpeed: session.enhancedMaxSpeed ?? session.maxSpeed,
      avgCadence: session.avgRunningCadence ?? session.avgCadence,
      avgPower: session.avgPower,
      elevationGain: session.totalAscent,
      aerobicTE: session.totalTrainingEffect,
      anaerobicTE: session.totalAnaerobicTrainingEffect,
      laps,
      sets: sets.length ? sets : undefined,
      series: buildSeries(points),
      source: 'file',
    },
  ];
}

export async function importActivityFile(file: File): Promise<GarminActivity[]> {
  const name = file.name;
  const lower = name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (lower.endsWith('.zip')) {
    const entries = unzipSync(buf);
    const out: GarminActivity[] = [];
    for (const [entryName, data] of Object.entries(entries)) {
      const el = entryName.toLowerCase();
      if (el.endsWith('.fit')) out.push(...(await parseFIT(data, entryName)));
      else if (el.endsWith('.tcx')) out.push(...parseTCX(new TextDecoder().decode(data), entryName));
      else if (el.endsWith('.gpx')) out.push(...parseGPX(new TextDecoder().decode(data), entryName));
    }
    return out;
  }
  if (lower.endsWith('.fit')) return parseFIT(buf, name);
  const text = new TextDecoder().decode(buf);
  if (lower.endsWith('.tcx') || text.includes('TrainingCenterDatabase')) return parseTCX(text, name);
  if (lower.endsWith('.gpx') || text.includes('<gpx')) return parseGPX(text, name);
  throw new Error('Поддерживаются файлы .fit, .tcx, .gpx и .zip');
}
