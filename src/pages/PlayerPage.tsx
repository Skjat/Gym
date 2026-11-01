import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, type ActiveWorkout } from '../store/store';
import type { LiveTip, SetLog, WorkoutSession } from '../types';
import { getExercise } from '../data/library';
import { ExerciseMedia } from '../components/ExerciseMedia';
import { Icon } from '../components/Icon';
import { Sheet, Stepper, toast } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { clock, distance as fmtDistance, pace as fmtPace } from '../lib/format';
import { repsNumber, stepDuration, targetText, type FlatStep } from '../lib/workoutFlow';
import { beep, speak, unlockSpeech, vibrate } from '../lib/speech';
import { keepScreenOn } from '../lib/wakeLock';
import { bleSupported, hrMonitor } from '../lib/ble';
import { GeoTracker } from '../lib/geo';
import { hrStats, rmssd, ZONE_COLORS, zoneBounds, zoneOf, zoneSeconds } from '../lib/hr';
import { annotateSetsHR, computeMetrics, matchActivity } from '../lib/session';
import { friendlyError, liveTip } from '../coach/claude';
import { uid } from '../lib/id';
import { BLOCK_KINDS } from '../data/taxonomy';
import { todayISO } from '../lib/format';

const FEELINGS = ['Отлично', 'Хорошо', 'Нормально', 'Тяжело', 'Плохо'];

function spokenTarget(s: FlatStep): string {
  if (s.measure === 'time') return `${stepDuration(s)} секунд${s.side === 'each' ? ', по половине на каждую сторону' : ''}`;
  if (s.measure === 'distance' && s.distanceM) return `${s.distanceM} метров`;
  if (s.reps) return `${s.reps} повторений${s.side === 'each' ? ' на каждую сторону' : ''}`;
  return '';
}

function lastWeightFor(step: FlatStep, active: ActiveWorkout): number | undefined {
  const inSession = [...active.session.sets].reverse().find((x) => x.itemId === step.itemId && x.weightKg);
  if (inSession) return inSession.weightKg;
  for (const s of useStore.getState().sessions) {
    const hit = [...s.sets].reverse().find((x) => x.exerciseId && x.exerciseId === step.exerciseId && x.weightKg && !x.skipped);
    if (hit) return hit.weightKg;
  }
  const m = step.load?.match(/(\d+(?:[.,]\d+)?)\s*кг/);
  return m ? Number(m[1].replace(',', '.')) : undefined;
}

export default function PlayerPage() {
  const nav = useNavigate();
  const active = useStore((s) => s.active);
  const profile = useStore((s) => s.profile);
  const settings = useStore((s) => s.settings);
  const garminRest = useStore((s) => [...s.garmin.daily].sort((a, b) => b.date.localeCompare(a.date))[0]?.restingHR);
  const patchActive = useStore((s) => s.patchActive);
  const [now, setNow] = useState(Date.now());
  const [reps, setReps] = useState<number | undefined>();
  const [weight, setWeight] = useState<number | undefined>();
  const [bpm, setBpm] = useState<number | undefined>(hrMonitor.last && Date.now() - hrMonitor.last.at < 5000 ? hrMonitor.last.bpm : undefined);
  const [hrStatus, setHrStatus] = useState(hrMonitor.status);
  const [finishOpen, setFinishOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  const [tipBusy, setTipBusy] = useState(false);
  const [rpe, setRpe] = useState<number | undefined>();
  const [feeling, setFeeling] = useState<string>();
  const [notes, setNotes] = useState('');
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsTick, setGpsTick] = useState(0);
  const geo = useRef<GeoTracker | null>(null);
  const stepGpsStart = useRef(0);
  const lastSpoken = useRef<string>('');
  const lastHrPush = useRef(0);
  const lastTipAt = useRef(0);
  const lastTipItem = useRef<string>('');
  const zoneAlertAt = useRef(0);
  const overZoneSince = useRef(0);
  const transitionKey = useRef('');

  const step = active?.steps[active.index];
  const next = active?.steps[active.index + 1];
  const paused = !!active?.pausedAt;
  const phaseElapsed = active ? ((active.pausedAt ?? now) - active.phaseStart) / 1000 : 0;
  const totalElapsed = active ? (now - active.t0) / 1000 : 0;
  const bounds = useMemo(() => zoneBounds(profile, garminRest), [profile, garminRest]);
  const zone = bpm ? zoneOf(bpm, bounds) : 0;
  const ex = getExercise(step?.exerciseId);

  // ── clock, screen, gps ──
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    keepScreenOn(true);
    return () => {
      clearInterval(t);
      keepScreenOn(false);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const hasDistance = active.steps.some((s) => s.measure === 'distance') || active.session.discipline === 'running';
    if (hasDistance && 'geolocation' in navigator) setGpsOn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.session.id]);

  useEffect(() => {
    if (!gpsOn) return;
    const g = new GeoTracker();
    g.onUpdate = () => setGpsTick((x) => x + 1);
    g.start();
    geo.current = g;
    return () => {
      g.stop();
      geo.current = null;
    };
  }, [gpsOn]);

  // ── heart rate over Bluetooth ──
  useEffect(() => {
    const offStatus = hrMonitor.onStatus((s) => setHrStatus(s as typeof hrMonitor.status));
    const offReading = hrMonitor.onReading((r) => {
      setBpm(r.bpm);
      const a = useStore.getState().active;
      if (!a || a.pausedAt) return;
      if (Date.now() - lastHrPush.current >= 2000) {
        lastHrPush.current = Date.now();
        const t = Math.round((Date.now() - a.t0) / 1000);
        useStore.getState().patchActive((x) => ({ ...x, session: { ...x.session, hr: [...x.session.hr, { t, bpm: r.bpm }] } }));
      }
    });
    return () => {
      offStatus();
      offReading();
    };
  }, []);

  // ── prefill inputs when the step changes ──
  useEffect(() => {
    if (!active || !step) return;
    setReps(repsNumber(step.reps));
    setWeight(step.weighted ? lastWeightFor(step, active) : undefined);
    stepGpsStart.current = geo.current?.distanceM ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key]);

  // ── voice: announce new work step / rest ──
  useEffect(() => {
    if (!active || !step) return;
    const key = `${active.phase}:${step.key}:${active.phaseStart}`;
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    if (active.phase === 'work') {
      speak(`${step.name}. ${spokenTarget(step)}`, { interrupt: true });
    } else if (active.phase === 'rest') {
      speak(`Отдых ${active.restSec} секунд.${next ? ` Далее: ${next.name}.` : ''}`, { interrupt: true });
    }
  }, [active, step, next]);

  const pushTip = useCallback((text: string, source: LiveTip['source']) => {
    const a = useStore.getState().active;
    if (!a) return;
    const tip: LiveTip = { t: Math.round((Date.now() - a.t0) / 1000), text, source };
    useStore.getState().patchActive((x) => ({ ...x, session: { ...x.session, tips: [...x.session.tips, tip] } }));
    speak(text);
  }, []);

  // ── finishing a set / advancing ──
  const advance = useCallback(() => {
    patchActive((a) => {
      const idx = a.index + 1;
      if (idx >= a.steps.length) return { ...a, phase: 'rest', restSec: 0, phaseStart: Date.now(), index: a.steps.length - 1 };
      return { ...a, index: idx, phase: 'work', phaseStart: Date.now(), restSec: 0 };
    });
  }, [patchActive]);

  const complete = useCallback(
    (skipped = false) => {
      const a = useStore.getState().active;
      if (!a) return;
      const s = a.steps[a.index];
      const endedAt = (Date.now() - a.t0) / 1000;
      const startedAt = Math.min(endedAt, (a.phaseStart - a.t0) / 1000);
      const gpsDist = geo.current ? geo.current.distanceM - stepGpsStart.current : 0;
      const log: SetLog = {
        id: uid('set'),
        blockId: s.blockId,
        itemId: s.itemId,
        exerciseId: s.exerciseId,
        exerciseName: s.name,
        round: s.round,
        setIndex: s.setIndex,
        reps: s.measure === 'reps' && !skipped ? reps : undefined,
        weightKg: s.weighted && !skipped ? weight : undefined,
        durationSec: s.measure !== 'reps' && !skipped ? Math.round(endedAt - startedAt) : undefined,
        distanceM: s.measure === 'distance' && !skipped ? Math.round(gpsDist > 50 ? gpsDist : s.distanceM ?? 0) || undefined : undefined,
        skipped: skipped || undefined,
        startedAt: Math.round(startedAt),
        endedAt: Math.round(endedAt),
      };
      const isLast = a.index >= a.steps.length - 1;
      const dup = (x: SetLog) => x.blockId === s.blockId && x.itemId === s.itemId && x.round === s.round && x.setIndex === s.setIndex;
      patchActive((x) => {
        const sets = [...x.session.sets.filter((y) => !dup(y)), log];
        const base = { ...x, session: { ...x.session, sets } };
        if (isLast) return { ...base, phase: 'rest', restSec: 0, phaseStart: Date.now() };
        if (!skipped && s.restAfterSec > 0 && settings.autoRestTimer) return { ...base, phase: 'rest', restSec: s.restAfterSec, phaseStart: Date.now() };
        return { ...base, index: x.index + 1, phase: 'work', phaseStart: Date.now() };
      });
      vibrate(80);
      if (isLast) {
        speak('Тренировка завершена! Отличная работа.', { interrupt: true });
        setFinishOpen(true);
      }
    },
    [patchActive, reps, weight, settings.autoRestTimer],
  );

  // ── timers: auto-complete timed sets, end rests, countdown beeps ──
  useEffect(() => {
    if (!active || !step || paused || finishOpen) return;
    const key = `${active.phase}:${active.index}:${active.phaseStart}`;
    if (active.phase === 'work' && step.measure === 'time') {
      const total = stepDuration(step);
      const left = total - phaseElapsed;
      const sec = Math.ceil(left);
      if (left > 0 && sec <= 3 && transitionKey.current !== `${key}:${sec}`) {
        transitionKey.current = `${key}:${sec}`;
        beep(660, 120);
      }
      if (step.side === 'each' && Math.abs(phaseElapsed - total / 2) < 0.3 && transitionKey.current !== `${key}:side`) {
        transitionKey.current = `${key}:side`;
        speak('Смена стороны');
        beep(990, 200);
      }
      if (left <= 0 && transitionKey.current !== `${key}:done`) {
        transitionKey.current = `${key}:done`;
        beep(990, 300);
        complete();
      }
    } else if (active.phase === 'rest' && active.restSec > 0) {
      const left = active.restSec - phaseElapsed;
      const sec = Math.ceil(left);
      if (left > 0 && sec <= 3 && transitionKey.current !== `${key}:${sec}`) {
        transitionKey.current = `${key}:${sec}`;
        beep(660, 120);
      }
      if (left <= 0 && transitionKey.current !== `${key}:done`) {
        transitionKey.current = `${key}:done`;
        beep(990, 250);
        vibrate([100, 60, 100]);
        advance();
      }
    }
  }, [now, active, step, paused, phaseElapsed, complete, advance, finishOpen]);

  // ── HR zone alert (local, free) ──
  useEffect(() => {
    if (!bpm || !step?.hrZone || active?.phase !== 'work') {
      overZoneSince.current = 0;
      return;
    }
    if (zone > step.hrZone) {
      overZoneSince.current ||= Date.now();
      if (Date.now() - overZoneSince.current > 20000 && Date.now() - zoneAlertAt.current > 90000) {
        zoneAlertAt.current = Date.now();
        pushTip(`Пульс ${bpm} — это зона ${zone}, а цель — зона ${step.hrZone}. Сбавь темп.`, 'zone');
      }
    } else overZoneSince.current = 0;
  }, [bpm, zone, step, active?.phase, pushTip]);

  // ── coach snapshot & live tips ──
  const snapshot = useCallback(
    (question?: string) => {
      const a = useStore.getState().active!;
      const s = a.steps[a.index];
      const n = a.steps[a.index + 1];
      const st = hrStats(a.session.hr);
      const zs = a.session.hr.length ? zoneSeconds(a.session.hr, bounds).map((x) => Math.round(x / 60)) : undefined;
      const lastSets = a.session.sets.slice(-6).map((x) =>
        `${x.exerciseName}: ${x.skipped ? 'пропущен' : [x.weightKg ? `${x.weightKg} кг` : '', x.reps ? `×${x.reps}` : '', x.durationSec ? `${x.durationSec} с` : '', x.distanceM ? `${x.distanceM} м` : ''].filter(Boolean).join(' ')}`,
      );
      const prevTips = a.session.tips.slice(-3).map((t) => t.text);
      return [
        `Тренировка «${a.session.title}», идёт ${clock((Date.now() - a.t0) / 1000)}, шаг ${a.index + 1} из ${a.steps.length}.`,
        `Сейчас: ${s.name} (${BLOCK_KINDS[s.blockKind]}), подход ${s.setIndex}/${s.sets}${s.rounds > 1 ? `, круг ${s.round}/${s.rounds}` : ''}, цель: ${targetText(s) || '—'}${s.load ? `, нагрузка ${s.load}` : ''}. Фаза: ${a.phase === 'rest' ? 'отдых' : 'работа'}.`,
        n ? `Далее: ${n.name} (${targetText(n)}).` : 'Это последний шаг.',
        bpm ? `Пульс сейчас ${bpm} (зона ${zone}), средний ${st.avg}, макс ${st.max}.${zs ? ` Минут в зонах Z1–Z5: ${zs.join('/')}.` : ''}` : 'Пульс не передаётся.',
        geo.current && geo.current.distanceM > 0 ? `Дистанция ${fmtDistance(geo.current.distanceM)}, текущий темп ${fmtPace(geo.current.currentPace())}.` : '',
        lastSets.length ? `Последние подходы: ${lastSets.join('; ')}.` : '',
        profile.injuries ? `Ограничения спортсмена: ${profile.injuries}.` : '',
        prevTips.length ? `Предыдущие подсказки: ${prevTips.join(' | ')}` : '',
        question ? `Сообщение спортсмена: ${question}` : 'Дай подсказку на ближайшие минуты.',
      ]
        .filter(Boolean)
        .join('\n');
    },
    [bounds, bpm, zone, profile.injuries],
  );

  const requestTip = useCallback(
    async (question?: string) => {
      if (!settings.apiKey) {
        toast('Добавьте API-ключ Claude в профиле');
        return;
      }
      setTipBusy(true);
      lastTipAt.current = Date.now();
      try {
        if (question) pushTip(question, 'user');
        const text = await liveTip(snapshot(question));
        if (text) pushTip(text, 'coach');
      } catch (e) {
        if (question) toast(friendlyError(e));
      } finally {
        setTipBusy(false);
      }
    },
    [settings.apiKey, snapshot, pushTip],
  );

  useEffect(() => {
    if (!active || !step || paused || !settings.apiKey || settings.liveTips === 'off' || tipBusy) return;
    const sinceLast = Date.now() - lastTipAt.current;
    if (settings.liveTips === 'exercise') {
      if (active.phase === 'work' && step.itemId !== lastTipItem.current && totalElapsed > 60 && sinceLast > 120000) {
        lastTipItem.current = step.itemId;
        requestTip();
      }
    } else {
      const every = Number(settings.liveTips) * 60000;
      if (lastTipAt.current === 0) lastTipAt.current = active.t0;
      if (Date.now() - lastTipAt.current > every) requestTip();
    }
  }, [now, active, step, paused, settings.apiKey, settings.liveTips, tipBusy, totalElapsed, requestTip]);

  // ── finish ──
  const finish = () => {
    const st = useStore.getState();
    const a = st.active;
    if (!a) return;
    let session: WorkoutSession = { ...a.session, endedAt: new Date().toISOString(), rpe, feeling, notes: notes.trim() || undefined, hrSource: a.session.hr.length ? ('ble' as const) : ('none' as const) };
    session = annotateSetsHR(session);
    session.metrics = computeMetrics(session, st.profile, garminRest, geo.current?.distanceM || undefined, rmssd(hrMonitor.rrLog));
    const act = matchActivity(session, st.garmin.activities);
    if (act) session.garminActivityId = act.id;
    st.saveSession(session);
    const planDay = st.plan.days.find((d) => d.id === a.session.planDayId) ?? st.plan.days.find((d) => d.date === todayISO() && d.workoutId === a.session.template.id);
    if (planDay) st.updatePlanDay(planDay.id, { status: 'done', sessionId: session.id });
    st.setActive(null);
    geo.current?.stop();
    nav(`/session/${session.id}`, { replace: true, state: { fresh: true } });
  };

  if (!active || !step) {
    return (
      <div className="player">
        <div className="empty" style={{ marginTop: '30vh' }}>
          <div className="big">🏁</div>
          Нет активной тренировки
          <div className="mt"><Link className="btn" to="/">На главную</Link></div>
        </div>
      </div>
    );
  }

  const progress = (active.session.sets.length / active.steps.length) * 100;
  const timeLeft = step.measure === 'time' ? Math.max(0, stepDuration(step) - phaseElapsed) : 0;
  const restLeft = Math.max(0, active.restSec - phaseElapsed);
  const lastTip = [...active.session.tips].reverse().find((t) => t.source !== 'user');
  const allDone = active.session.sets.length >= active.steps.length && active.phase === 'rest' && active.restSec === 0;
  const gpsPace = geo.current?.currentPace();
  void gpsTick;

  return (
    <div className="player">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Свернуть"><Icon name="back" /></button>
        <div className="center grow">
          <div style={{ fontWeight: 700 }} className="ellipsis">{active.session.title}</div>
          <div className="faint small">{clock(totalElapsed)} · шаг {Math.min(active.index + 1, active.steps.length)}/{active.steps.length}</div>
        </div>
        <button className="icon-btn" onClick={() => setFinishOpen(true)} aria-label="Завершить"><Icon name="stop" /></button>
      </div>
      <div className="progress mb"><div style={{ width: `${progress}%` }} /></div>

      <div className="faint small" style={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
        {step.blockTitle}{step.rounds > 1 ? ` · круг ${step.round}/${step.rounds}` : ''}{step.sets > 1 ? ` · подход ${step.setIndex}/${step.sets}` : ''}
      </div>

      {active.phase === 'rest' && !allDone ? (
        <div className="card center" style={{ marginTop: 10 }}>
          <div className="faint">Отдых</div>
          <div className="big-timer rest">{clock(restLeft)}</div>
          <div className="btn-row">
            <button className="btn" onClick={() => patchActive((a) => ({ ...a, restSec: a.restSec + 15 }))}>+15 с</button>
            <button className="btn blue" onClick={advance}>Пропустить отдых</button>
          </div>
          {next && (
            <div className="mt">
              <div className="faint small">Далее</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{next.name}</div>
              <div className="faint">{targetText(next)}</div>
            </div>
          )}
        </div>
      ) : allDone ? (
        <div className="card center" style={{ marginTop: 10 }}>
          <div className="big">🎉</div>
          <h2>Всё выполнено!</h2>
          <button className="btn primary block" onClick={() => setFinishOpen(true)}>Завершить и сохранить</button>
        </div>
      ) : (
        <>
          <h1 style={{ fontSize: 28, margin: '4px 0 6px', lineHeight: 1.15 }}>{step.name}</h1>
          <div className="tags mb">
            <span className="tag accent">{targetText(step) || 'Выполните упражнение'}</span>
            {step.tempo && <span className="tag">темп {step.tempo}</span>}
          </div>
          {step.notes && <div className="muted small mb">{step.notes}</div>}
          {ex && (
            <Link to={`/exercises/${encodeURIComponent(ex.id)}`}>
              <ExerciseMedia ex={ex} compact />
            </Link>
          )}

          {active.phase === 'ready' ? (
            <button
              className="btn primary big block mt"
              onClick={() => {
                unlockSpeech();
                patchActive((a) => ({ ...a, phase: 'work', phaseStart: Date.now() }));
              }}
            >
              <Icon name="play" fill /> Старт
            </button>
          ) : step.measure === 'time' ? (
            <div className="center">
              <div className="big-timer">{clock(timeLeft)}</div>
              {step.side === 'each' && <div className="faint">{phaseElapsed < stepDuration(step) / 2 ? 'Первая сторона' : 'Вторая сторона'}</div>}
              <button className="btn block mt" onClick={() => complete()}>Готово раньше</button>
            </div>
          ) : step.measure === 'distance' ? (
            <div className="center">
              <div className="big-timer">{clock(phaseElapsed)}</div>
              {gpsOn && <div className="muted">{fmtDistance((geo.current?.distanceM ?? 0) - stepGpsStart.current)} · {fmtPace(gpsPace)}</div>}
              <button className="btn primary big block mt" onClick={() => complete()}>Готово</button>
            </div>
          ) : (
            <div className="card" style={{ marginTop: 6 }}>
              <div className="row between">
                <span className="faint">Повторы</span>
                <Stepper value={reps} onChange={setReps} />
              </div>
              {step.weighted && (
                <div className="row between mt">
                  <span className="faint">Вес, кг</span>
                  <Stepper value={weight} onChange={setWeight} step={2.5} />
                </div>
              )}
              <div className="faint small center mt">{clock(phaseElapsed)} на подходе</div>
              <button className="btn primary big block mt" onClick={() => complete()}>✓ Подход выполнен</button>
            </div>
          )}
        </>
      )}

      <div className="row wrap mt" style={{ gap: 8 }}>
        {bpm ? (
          <span className="hr-pill" style={{ background: ZONE_COLORS[Math.max(0, zone - 1)] }}>
            <Icon name="heart" fill size={16} /> {bpm} · Z{zone}
            {step.hrZone ? <span style={{ opacity: 0.8 }}> / цель Z{step.hrZone}</span> : null}
          </span>
        ) : bleSupported() ? (
          <button className="btn small" onClick={() => hrMonitor.connect().catch((e) => toast((e as Error).message))}>
            <Icon name="bt" size={16} /> {hrStatus === 'connecting' ? 'Подключение…' : 'Пульс с часов'}
          </button>
        ) : (
          <span className="faint small">Живой пульс: откройте в Bluefy</span>
        )}
        {gpsOn ? (
          <span className="tag blue">📍 {fmtDistance(geo.current?.distanceM ?? 0)} · {fmtPace(gpsPace)}</span>
        ) : (
          'geolocation' in navigator && <button className="btn small" onClick={() => setGpsOn(true)}>📍 GPS</button>
        )}
      </div>

      {lastTip && (
        <div className="tip mt">
          <b>{lastTip.source === 'zone' ? '❤️ ' : '🧑‍🏫 '}</b>
          <Markdown text={lastTip.text} />
        </div>
      )}

      <div style={{ flex: 1 }} />
      <div className="btn-row mt">
        <button className="btn" disabled={active.index === 0} onClick={() => patchActive((a) => ({ ...a, index: Math.max(0, a.index - 1), phase: 'work', phaseStart: Date.now() }))}>
          <Icon name="prev" size={18} />
        </button>
        {paused ? (
          <button className="btn blue" onClick={() => patchActive((a) => ({ ...a, phaseStart: a.phaseStart + (Date.now() - (a.pausedAt ?? Date.now())), pausedAt: undefined }))}>
            <Icon name="play" fill size={18} /> Продолжить
          </button>
        ) : (
          <button className="btn" onClick={() => patchActive((a) => ({ ...a, pausedAt: Date.now() }))}>
            <Icon name="pause" size={18} /> Пауза
          </button>
        )}
        <button className="btn" onClick={() => complete(true)} disabled={allDone}>
          <Icon name="skip" size={18} />
        </button>
      </div>
      <button className="btn block mt" onClick={() => setAskOpen(true)} disabled={tipBusy}>
        <Icon name="sparkle" size={18} /> {tipBusy ? 'Тренер думает…' : 'Спросить тренера'}
      </button>

      <Sheet open={askOpen} onClose={() => setAskOpen(false)} title="Спросить тренера">
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {['Слишком легко', 'Слишком тяжело', 'Что-то болит', 'Как правильно дышать?', 'Как держать темп?'].map((q) => (
            <button key={q} className="chip outline" onClick={() => { setAskOpen(false); requestTip(q); }}>{q}</button>
          ))}
        </div>
        <textarea className="textarea mt" value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="Свой вопрос…" />
        <button className="btn primary block mt" disabled={!askText.trim()} onClick={() => { setAskOpen(false); requestTip(askText.trim()); setAskText(''); }}>
          Отправить
        </button>
        {active.session.tips.length > 0 && (
          <div className="mt">
            <div className="faint small mb">Подсказки за тренировку</div>
            {[...active.session.tips].reverse().map((t, i) => (
              <div key={i} className="small" style={{ padding: '4px 0' }}>
                <span className="faint">{clock(t.t)} {t.source === 'user' ? 'вы' : t.source === 'zone' ? 'пульс' : 'тренер'}:</span> {t.text}
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Завершить тренировку">
        <div className="faint small mb">Выполнено подходов: {active.session.sets.filter((s) => !s.skipped).length} из {active.steps.length} · {clock(totalElapsed)}</div>
        <div className="field">
          <span>Насколько тяжело было (RPE 1–10)?</span>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`chip ${rpe === n ? 'on' : 'outline'}`} style={{ minWidth: 42 }} onClick={() => setRpe(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Самочувствие</span>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {FEELINGS.map((f) => (
              <button key={f} className={`chip ${feeling === f ? 'on' : 'outline'}`} onClick={() => setFeeling(f)}>{f}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Заметки (что получилось, что беспокоило)</span>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="btn primary block big" onClick={finish}>Сохранить тренировку</button>
        <button
          className="btn danger block mt"
          onClick={() => {
            if (confirm('Выйти без сохранения? Данные тренировки пропадут.')) {
              useStore.getState().setActive(null);
              nav('/', { replace: true });
            }
          }}
        >
          Выйти без сохранения
        </button>
      </Sheet>
    </div>
  );
}
