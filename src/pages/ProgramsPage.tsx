import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { allPrograms, programOrigin } from '../data/library';
import { useStore } from '../store/store';
import { Chips, OriginTag, Page } from '../components/ui';
import { Icon } from '../components/Icon';
import { DIFFICULTIES, disciplineIcon, tagLabel } from '../data/taxonomy';
import { humanDate } from '../lib/format';
import { chatForToday } from '../coach/flows';
import type { Program } from '../types';

const GROUPS: { id: string; label: string; icon: string; test: (p: Program) => boolean }[] = [
  { id: 'coach', label: 'От тренера', icon: '✨', test: (p) => programOrigin(p.id) !== 'builtin' },
  { id: 'gym', label: 'Зал', icon: '🏢', test: (p) => p.locations.includes('gym') && ['strength', 'hiit', 'calisthenics'].includes(p.discipline) },
  { id: 'home', label: 'Дом', icon: '🏠', test: (p) => p.locations.includes('home') },
  { id: 'outdoor', label: 'Улица', icon: '🌳', test: (p) => p.locations.includes('outdoor') },
  { id: 'running', label: 'Бег', icon: '🏃', test: (p) => p.discipline === 'running' },
  { id: 'yoga', label: 'Йога', icon: '🧘', test: (p) => p.discipline === 'yoga' },
  { id: 'stretch', label: 'Растяжка', icon: '🙆', test: (p) => ['stretching', 'mobility', 'recovery'].includes(p.discipline) },
  { id: 'strength', label: 'Силовая', icon: '🏋️', test: (p) => p.discipline === 'strength' || p.discipline === 'calisthenics' },
  { id: 'hiit', label: 'HIIT', icon: '⚡', test: (p) => p.discipline === 'hiit' },
  { id: 'other', label: 'Пилатес и дыхание', icon: '🌀', test: (p) => ['pilates', 'breathing'].includes(p.discipline) },
];

export default function ProgramsPage() {
  const nav = useNavigate();
  const [group, setGroup] = useState('');
  const [level, setLevel] = useState<string>('');
  const saved = useStore((s) => s.savedWorkouts);
  const customPrograms = useStore((s) => s.customPrograms);
  const programs = useMemo(() => allPrograms(), [customPrograms]);
  const list = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group);
    return programs.filter((p) => (!g || g.test(p)) && (!level || p.level === level));
  }, [programs, group, level]);

  const askNew = () =>
    nav(`/coach/${chatForToday().id}`, {
      state: { autoSend: 'Создай для меня новую программу тренировок под мои цели и возможности и сохрани её в приложении. Сначала уточни, если чего-то не хватает: ' },
    });

  return (
    <Page title="Программы" sub={`${programs.length} программ для зала, дома и улицы`}>
      <Chips options={GROUPS.map(({ id, label, icon }) => ({ id, label, icon }))} value={group} onChange={setGroup} allLabel="Все" />
      <Chips options={DIFFICULTIES} value={level} onChange={setLevel} allLabel="Любой уровень" />

      {saved.length > 0 && !group && (
        <>
          <div className="section-title"><span>Мои тренировки</span></div>
          <div className="list">
            {saved.slice(0, 8).map((w) => (
              <Link key={w.id} to={`/workout/${w.id}`} className="list-item">
                <div className="thumb">{w.createdBy === 'coach' ? '✨' : disciplineIcon(w.discipline)}</div>
                <div className="grow">
                  <div className="title ellipsis">{w.title}</div>
                  <div className="meta">{w.createdBy === 'coach' ? 'от тренера' : 'своя'}{w.createdAt ? ` · ${humanDate(w.createdAt)}` : ''} · {w.estimatedMinutes ?? '—'} мин</div>
                </div>
                <Icon name="chevron" size={18} />
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><span>{group === 'coach' ? 'Созданные и изменённые' : 'Программы'}</span><span className="faint">{list.length}</span></div>
      {list.map((p) => (
        <Link key={p.id} to={`/programs/${encodeURIComponent(p.id)}`} className="card" style={{ display: 'block', color: 'var(--text)' }}>
          <div className="row">
            <div className="thumb">{disciplineIcon(p.discipline)}</div>
            <div className="grow">
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <div className="faint">{p.subtitle}</div>
            </div>
          </div>
          <div className="tags mt">
            <OriginTag origin={programOrigin(p.id)} />
            <span className="tag accent">{tagLabel('difficulty', p.level)}</span>
            {p.locations.map((l) => <span key={l} className="tag">{tagLabel('location', l)}</span>)}
            {p.sessionsPerWeek && <span className="tag">{p.sessionsPerWeek}×/нед</span>}
            {p.weeks && <span className="tag">{p.weeks} нед</span>}
            <span className="tag">{p.workouts.length} трен.</span>
          </div>
        </Link>
      ))}
      {!list.length && <div className="empty">{group === 'coach' ? 'Тренер пока не создавал и не менял программы.' : 'Нет программ с такими фильтрами'}</div>}

      <button className="btn block mt" onClick={askNew}>
        <Icon name="sparkle" size={18} /> Новая программа с тренером
      </button>
    </Page>
  );
}
