import type { AthleteProfile, HRSample } from '../types';

export const ZONE_COLORS = ['#7c8a9a', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];
export const ZONE_NAMES = ['Восстановление', 'Аэробная база', 'Темповая', 'Пороговая', 'Максимальная'];

export function ageOf(profile: AthleteProfile): number | undefined {
  return profile.birthYear ? new Date().getFullYear() - profile.birthYear : undefined;
}

export function effectiveMaxHR(profile: AthleteProfile): number {
  if (profile.maxHR) return profile.maxHR;
  const age = ageOf(profile) ?? 35;
  return Math.round(208 - 0.7 * age); // Tanaka
}

export function effectiveRestHR(profile: AthleteProfile, garminRest?: number): number {
  return profile.restingHR ?? garminRest ?? 60;
}

/** Lower bounds (bpm) of zones 1..5 and the max. */
export function zoneBounds(profile: AthleteProfile, garminRest?: number): number[] {
  const max = effectiveMaxHR(profile);
  const pct = [0.5, 0.6, 0.7, 0.8, 0.9];
  if (profile.zoneMethod === 'karvonen') {
    const rest = effectiveRestHR(profile, garminRest);
    return [...pct.map((p) => Math.round(rest + (max - rest) * p)), max];
  }
  return [...pct.map((p) => Math.round(max * p)), max];
}

/** 0 = below zone 1, 1..5 = zone. */
export function zoneOf(bpm: number, bounds: number[]): number {
  let z = 0;
  for (let i = 0; i < 5; i++) if (bpm >= bounds[i]) z = i + 1;
  return z;
}

export function zoneSeconds(samples: HRSample[], bounds: number[]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 1; i < samples.length; i++) {
    const dt = Math.min(samples[i].t - samples[i - 1].t, 10);
    const z = zoneOf(samples[i].bpm, bounds);
    if (z > 0 && dt > 0) out[z - 1] += dt;
  }
  return out;
}

export function hrStats(samples: HRSample[]) {
  if (!samples.length) return {};
  let sum = 0;
  let max = 0;
  let min = 999;
  for (const s of samples) {
    sum += s.bpm;
    max = Math.max(max, s.bpm);
    min = Math.min(min, s.bpm);
  }
  return { avg: Math.round(sum / samples.length), max, min };
}

/** Banister TRIMP (training impulse). */
export function trimp(samples: HRSample[], rest: number, max: number, female = false): number {
  let total = 0;
  const k = female ? 1.67 : 1.92;
  for (let i = 1; i < samples.length; i++) {
    const dtMin = Math.min(samples[i].t - samples[i - 1].t, 10) / 60;
    const hrr = Math.max(0, Math.min(1, (samples[i].bpm - rest) / (max - rest)));
    total += dtMin * hrr * 0.64 * Math.exp(k * hrr);
  }
  return Math.round(total);
}

export function samplesBetween(samples: HRSample[], from: number, to: number): HRSample[] {
  return samples.filter((s) => s.t >= from && s.t <= to);
}

/** RMSSD from RR intervals (ms). */
export function rmssd(rr: number[]): number | undefined {
  if (rr.length < 10) return undefined;
  let sum = 0;
  for (let i = 1; i < rr.length; i++) sum += (rr[i] - rr[i - 1]) ** 2;
  return Math.round(Math.sqrt(sum / (rr.length - 1)));
}
