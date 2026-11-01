import type { AppState } from '../store/store';
import type { GarminActivity, GarminDaily, WorkoutSession } from '../types';
import { allExercises, allPrograms, exerciseOrigin, programOrigin } from '../data/library';
import { tagLabel } from '../data/taxonomy';
import { addDays, duration, todayISO, weekdayLong, distance, pace, speedToPace } from '../lib/format';
import { effectiveMaxHR, zoneBounds } from '../lib/hr';

export function profileText(s: AppState): string {
  const p = s.profile;
  const lines = [
    p.name && `Имя: ${p.name}`,
    p.sex && `Пол: ${p.sex === 'male' ? 'мужской' : 'женский'}`,
    p.birthYear && `Год рождения: ${p.birthYear}`,
    p.heightCm && `Рост: ${p.heightCm} см`,
    p.weightKg && `Вес: ${p.weightKg} кг`,
    `Уровень: ${tagLabel('difficulty', p.level)}`,
    p.goals && `Цели: ${p.goals}`,
    p.injuries && `Травмы и ограничения: ${p.injuries}`,
    p.preferences && `Предпочтения: ${p.preferences}`,
    p.locations.length && `Где тренируется: ${p.locations.map((l) => tagLabel('location', l)).join(', ')}`,
    p.equipment.length && `Инвентарь дома/под рукой: ${p.equipment.map((e) => tagLabel('equipment', e)).join(', ')}`,
    p.sessionsPerWeek && `Тренировок в неделю: ${p.sessionsPerWeek}`,
    p.sessionMinutes && `Обычная длительность: ${p.sessionMinutes} мин`,
  ].filter(Boolean);
  const max = effectiveMaxHR(p);
  const b = zoneBounds(p, latestDaily(s)?.restingHR);
  lines.push(
    `Пульс: максимум ${max}${p.maxHR ? '' : ' (расчётный)'}; зоны (${p.zoneMethod === 'karvonen' ? 'Карвонен' : '% от макс.'}): ` +
      `Z1 ${b[0]}–${b[1] - 1}, Z2 ${b[1]}–${b[2] - 1}, Z3 ${b[2]}–${b[3] - 1}, Z4 ${b[3]}–${b[4] - 1}, Z5 ${b[4]}+`,
  );
  if (s.coachNotes.length) {
    lines.push('Заметки тренера о спортсмене:');
    for (const n of s.coachNotes.slice(-40)) lines.push(`- [${n.date}, ${n.category}] ${n.text}`);
  }
  return lines.join('\n');
}

export function catalogText(): string {
  const mark = (id: string) => ({ edited: ' (изменено)', custom: ' (создано тренером)' } as Record<string, string>)[exerciseOrigin(id)] ?? '';
  return allExercises(false).map((e) =>
    [
      e.id,
      e.name + mark(e.id),
      e.disciplines.join(','),
      e.locations.join(','),
      e.primaryMuscles.join(','),
      e.equipment.join(','),
      e.difficulty[0],
      e.measure,
    ].join(' | '),
  ).join('\n');
}

export function programsText(): string {
  const mark: Record<string, string> = { edited: ' (изменена)', custom: ' (создана тренером)', builtin: '' };
  return allPrograms()
    .map((p) => `${p.id} | ${p.title}${mark[programOrigin(p.id)]} | ${p.discipline} | ${p.level} | ${p.workouts.length} трен.`)
    .join('\n');
}

export function latestDaily(s: AppState): GarminDaily | undefined {
  const sorted = [...s.garmin.daily].sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0];
}

export function dailyLine(d: GarminDaily): string {
  const parts = [
    d.sleepSec && `сон ${duration(d.sleepSec)}${d.sleepScore ? ` (оценка ${d.sleepScore})` : ''}`,
    d.hrvLastNight && `HRV ${d.hrvLastNight} мс${d.hrvWeeklyAvg ? ` (неделя ${d.hrvWeeklyAvg})` : ''}${d.hrvStatus ? `, статус ${d.hrvStatus}` : ''}`,
    d.restingHR && `пульс покоя ${d.restingHR}`,
    (d.bodyBatteryMorning ?? d.bodyBatteryHigh) && `Body Battery ${d.bodyBatteryMorning ?? d.bodyBatteryHigh}`,
    d.readinessScore && `готовность ${d.readinessScore}${d.readinessLevel ? ` (${d.readinessLevel})` : ''}`,
    d.stressAvg && `стресс ${d.stressAvg}`,
    d.trainingStatus && `статус ${d.trainingStatus}`,
    d.acuteLoad && `острая нагрузка ${d.acuteLoad}`,
    d.vo2max && `VO2max ${d.vo2max}`,
    d.steps && `шаги ${d.steps}`,
  ].filter(Boolean);
  return `${d.date}: ${parts.join(', ') || 'нет данных'}`;
}

export function sessionLine(s: WorkoutSession): string {
  const m = s.metrics;
  const parts = [
    `${s.startedAt.slice(0, 16).replace('T', ' ')} «${s.title}» [id ${s.id}]`,
    m?.durationSec && duration(m.durationSec),
    m?.setsDone && `${m.setsDone} подх.`,
    m?.totalVolumeKg && `объём ${Math.round(m.totalVolumeKg)} кг`,
    m?.distanceM && distance(m.distanceM),
    m?.avgHR && `пульс ср ${m.avgHR}/макс ${m.maxHR}`,
    m?.trimp && `TRIMP ${m.trimp}`,
    s.rpe && `RPE ${s.rpe}`,
    s.feeling && `самочувствие: ${s.feeling}`,
  ].filter(Boolean);
  return parts.join(', ');
}

export function activityLine(a: GarminActivity): string {
  const parts = [
    `${a.start.slice(0, 16).replace('T', ' ')} ${a.name} (${a.type}) [id ${a.id}]`,
    duration(a.durationSec),
    a.distanceM && distance(a.distanceM),
    a.avgSpeed && a.distanceM && `темп ${pace(speedToPace(a.avgSpeed))}`,
    a.avgHR && `пульс ср ${a.avgHR}/макс ${a.maxHR}`,
    a.aerobicTE && `TE аэроб ${a.aerobicTE}`,
    a.anaerobicTE && `анаэроб ${a.anaerobicTE}`,
    a.trainingLoad && `нагрузка ${Math.round(a.trainingLoad)}`,
    a.calories && `${a.calories} ккал`,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Compact per-turn context, prepended to the user's message when it changed. */
export function turnContext(s: AppState): string {
  const today = todayISO();
  const lines = [`Сегодня: ${today} (${weekdayLong(today)}), время ${new Date().toTimeString().slice(0, 5)}.`];
  const daily = [...s.garmin.daily].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  if (daily.length) {
    lines.push('Восстановление (Garmin):');
    daily.forEach((d) => lines.push(`- ${dailyLine(d)}`));
  }
  const planToday = s.plan.days.filter((d) => d.date >= addDays(today, -1) && d.date <= addDays(today, 2));
  if (planToday.length) {
    lines.push('План рядом с сегодняшним днём:');
    planToday.forEach((d) =>
      lines.push(`- ${d.date}: ${d.title}${d.intensity ? ` (${d.intensity})` : ''} — ${d.status}${d.workoutId ? ` [workoutId ${d.workoutId}]` : ''}`),
    );
  }
  const recent = s.sessions.slice(0, 3);
  if (recent.length) {
    lines.push('Последние тренировки в приложении:');
    recent.forEach((x) => lines.push(`- ${sessionLine(x)}`));
  }
  const acts = s.garmin.activities.slice(0, 3);
  if (acts.length) {
    lines.push('Последние активности Garmin:');
    acts.forEach((a) => lines.push(`- ${activityLine(a)}`));
  }
  return lines.join('\n');
}
