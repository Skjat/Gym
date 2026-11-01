import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { Page, Stat, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { addDays, duration, humanDate, relativeDay, todayISO, weekStart, weekdayLong, weekdayShort, parseISODate, humanDateTime } from '../lib/format';
import { chatForToday, QUICK_PROMPTS } from '../coach/flows';
import { findWorkout } from '../coach/tools';
import { startWorkout } from '../lib/player';
import { INTENSITIES, disciplineIcon } from '../data/taxonomy';
import { refreshGarmin } from '../lib/garminLink';
import { syncConfigured } from '../lib/garminSync';
import type { PlanDay } from '../types';

const INTENSITY_COLOR: Record<string, string> = { easy: 'var(--green)', moderate: 'var(--yellow)', hard: 'var(--red)', rest: 'var(--text3)' };

function Readiness() {
  const daily = useStore((s) => s.garmin.daily);
  const settings = useStore((s) => s.settings);
  const updatedAt = useStore((s) => s.garmin.updatedAt);
  const [busy, setBusy] = useState(false);
  const d = [...daily].sort((a, b) => b.date.localeCompare(a.date))[0];
  const refresh = async () => {
    setBusy(true);
    try {
      await refreshGarmin();
      toast('Данные Garmin обновлены');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!d) {
    return (
      <Link to="/garmin" className="card row" style={{ color: 'var(--text)' }}>
        <div className="thumb">⌚</div>
        <div className="grow">
          <h3>Подключите Garmin</h3>
          <div className="faint">Сон, HRV, Body Battery и тренировки с часов — тренер будет учитывать восстановление.</div>
        </div>
        <Icon name="chevron" />
      </Link>
    );
  }
  return (
    <div className="card">
      <div className="row between mb">
        <h2 style={{ margin: 0 }}>Восстановление</h2>
        {syncConfigured(settings) && (
          <button className="btn ghost small" onClick={refresh} disabled={busy}>
            <Icon name="refresh" size={18} /> {busy ? '…' : 'Обновить'}
          </button>
        )}
      </div>
      <div className="readiness">
        <Stat v={d.sleepSec ? duration(d.sleepSec).replace(' мин', 'м').replace(' ч ', 'ч ') : '—'} l={`Сон${d.sleepScore ? ` · ${d.sleepScore}` : ''}`} />
        <Stat v={d.hrvLastNight ?? '—'} l="HRV, мс" />
        <Stat v={d.bodyBatteryMorning ?? d.bodyBatteryHigh ?? '—'} l="Body Battery" />
        <Stat v={d.restingHR ?? '—'} l="Пульс покоя" />
      </div>
      <div className="faint small mt">
        {d.readinessScore ? `Готовность к тренировке: ${d.readinessScore}${d.readinessLevel ? ` (${d.readinessLevel})` : ''} · ` : ''}
        {d.date === todayISO() ? 'сегодня' : humanDate(d.date)}
        {updatedAt ? ` · синхр. ${humanDateTime(updatedAt)}` : ''}
      </div>
    </div>
  );
}

function WeekStrip({ days }: { days: PlanDay[] }) {
  const today = todayISO();
  const start = weekStart(today);
  const sessions = useStore((s) => s.sessions);
  return (
    <Link to="/plan" className="week" style={{ color: 'var(--text)' }}>
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => {
        const p = days.find((d) => d.date === date);
        const done = p?.status === 'done' || sessions.some((s) => s.startedAt.slice(0, 10) === date);
        return (
          <div key={date} className={`day ${date === today ? 'today' : ''}`}>
            <div className="dn">{weekdayShort(date)}</div>
            <div className="dd">{parseISODate(date).getDate()}</div>
            <div className="mk" style={{ background: done ? 'var(--green)' : p ? INTENSITY_COLOR[p.intensity ?? 'moderate'] : 'transparent' }} />
          </div>
        );
      })}
    </Link>
  );
}

export default function TodayPage() {
  const nav = useNavigate();
  const profile = useStore((s) => s.profile);
  const apiKey = useStore((s) => s.settings.apiKey);
  const plan = useStore((s) => s.plan);
  const sessions = useStore((s) => s.sessions);
  const [text, setText] = useState('');
  const today = todayISO();
  const todayPlan = plan.days.find((d) => d.date === today);
  const nextPlan = plan.days.find((d) => d.date > today && d.status === 'planned');
  const todayWorkout = findWorkout(todayPlan?.workoutId);

  const ask = (q: string) => {
    if (!q.trim()) return;
    const conv = chatForToday();
    nav(`/coach/${conv.id}`, { state: { autoSend: q.trim() } });
  };

  const hello = (() => {
    const h = new Date().getHours();
    return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  })();

  return (
    <Page title={`${hello}${profile.name ? `, ${profile.name}` : ''}`} sub={`${weekdayLong(today)}, ${humanDate(today)}`}>
      {!apiKey && (
        <Link to="/profile" className="card row" style={{ color: 'var(--text)', border: '1.5px solid var(--accent)' }}>
          <div className="thumb">🔑</div>
          <div className="grow">
            <h3>Подключите Claude</h3>
            <div className="faint">Добавьте API-ключ в профиле — и тренер начнёт подбирать тренировки.</div>
          </div>
          <Icon name="chevron" />
        </Link>
      )}

      <div className="hero">
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Что тренируем сегодня?</div>
        <div className="prompt-box">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Например: 40 минут в зале, ноги и кор, колено немного беспокоит"
            style={{ background: 'rgba(255,255,255,0.95)', color: '#111' }}
          />
        </div>
        <div className="btn-row mt">
          <button className="btn primary" onClick={() => ask(text)} disabled={!text.trim()}>
            <Icon name="sparkle" size={18} /> Составить с тренером
          </button>
        </div>
        <div className="chips" style={{ marginTop: 10, paddingBottom: 0 }}>
          {QUICK_PROMPTS.slice(0, 6).map((q) => (
            <button key={q} className="chip" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>

      <Readiness />

      <div className="section-title">
        <span>План</span>
        <Link to="/plan">Весь план</Link>
      </div>
      <WeekStrip days={plan.days} />
      <div className="card mt">
        {todayPlan ? (
          <>
            <div className="row between">
              <h3>
                {disciplineIcon(todayPlan.discipline)} {todayPlan.title}
              </h3>
              <span className="tag">{INTENSITIES[todayPlan.intensity ?? ''] ?? ''}</span>
            </div>
            {todayPlan.description && <div className="muted small">{todayPlan.description}</div>}
            <div className="btn-row mt">
              {todayWorkout && todayPlan.status !== 'done' && (
                <button className="btn primary" onClick={() => startWorkout(todayWorkout, todayPlan.id) && nav('/player')}>
                  <Icon name="play" fill size={18} /> Начать
                </button>
              )}
              {todayWorkout && <Link className="btn" to={`/workout/${todayWorkout.id}`}>Подробнее</Link>}
              {!todayWorkout && todayPlan.intensity !== 'rest' && (
                <button className="btn primary" onClick={() => ask(`Собери тренировку на сегодня по плану: «${todayPlan.title}». ${todayPlan.description ?? ''}`)}>
                  <Icon name="sparkle" size={18} /> Собрать тренировку
                </button>
              )}
            </div>
            {todayPlan.status === 'done' && <div className="tag green mt">✓ Выполнено</div>}
          </>
        ) : (
          <div className="faint">
            На сегодня ничего не запланировано.{' '}
            {nextPlan ? `Следующая: ${relativeDay(nextPlan.date)} — ${nextPlan.title}.` : ''}
            <div className="btn-row mt">
              <button className="btn small" onClick={() => ask('Составь план тренировок на ближайшую неделю с учётом моих целей и восстановления.')}>
                Составить план с тренером
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="section-title">
        <span>Последние тренировки</span>
        <Link to="/history">История</Link>
      </div>
      {sessions.length ? (
        <div className="list">
          {sessions.slice(0, 4).map((s) => (
            <Link key={s.id} to={`/session/${s.id}`} className="list-item">
              <div className="thumb">{disciplineIcon(s.discipline)}</div>
              <div className="grow">
                <div className="title ellipsis">{s.title}</div>
                <div className="meta">
                  {relativeDay(s.startedAt.slice(0, 10))} · {duration(s.metrics?.durationSec)}
                  {s.metrics?.avgHR ? ` · ❤️ ${s.metrics.avgHR}` : ''}
                  {s.analysis ? ' · разбор ✓' : ''}
                </div>
              </div>
              <Icon name="chevron" size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="card faint">Здесь появятся выполненные тренировки. Начните с программы или попросите тренера составить тренировку.</div>
      )}
    </Page>
  );
}
