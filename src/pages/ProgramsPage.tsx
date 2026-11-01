import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROGRAMS } from '../data/library';
import { useStore } from '../store/store';
import { Chips, Page } from '../components/ui';
import { Icon } from '../components/Icon';
import { DIFFICULTIES, disciplineIcon, tagLabel } from '../data/taxonomy';
import { humanDate } from '../lib/format';

const GROUPS = [
  { id: 'gym', label: 'Зал', icon: '🏢', test: (p: (typeof PROGRAMS)[number]) => p.locations.includes('gym') && ['strength', 'hiit', 'calisthenics'].includes(p.discipline) },
  { id: 'home', label: 'Дом', icon: '🏠', test: (p: (typeof PROGRAMS)[number]) => p.locations.includes('home') },
  { id: 'outdoor', label: 'Улица', icon: '🌳', test: (p: (typeof PROGRAMS)[number]) => p.locations.includes('outdoor') },
  { id: 'running', label: 'Бег', icon: '🏃', test: (p: (typeof PROGRAMS)[number]) => p.discipline === 'running' },
  { id: 'yoga', label: 'Йога', icon: '🧘', test: (p: (typeof PROGRAMS)[number]) => p.discipline === 'yoga' },
  { id: 'stretch', label: 'Растяжка', icon: '🙆', test: (p: (typeof PROGRAMS)[number]) => ['stretching', 'mobility', 'recovery'].includes(p.discipline) },
  { id: 'strength', label: 'Силовая', icon: '🏋️', test: (p: (typeof PROGRAMS)[number]) => p.discipline === 'strength' || p.discipline === 'calisthenics' },
  { id: 'hiit', label: 'HIIT', icon: '⚡', test: (p: (typeof PROGRAMS)[number]) => p.discipline === 'hiit' },
  { id: 'other', label: 'Пилатес и дыхание', icon: '🌀', test: (p: (typeof PROGRAMS)[number]) => ['pilates', 'breathing'].includes(p.discipline) },
] as const;

type GroupId = (typeof GROUPS)[number]['id'];

export default function ProgramsPage() {
  const [group, setGroup] = useState<GroupId | ''>('');
  const [level, setLevel] = useState<string>('');
  const saved = useStore((s) => s.savedWorkouts);
  const list = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group);
    return PROGRAMS.filter((p) => (!g || g.test(p)) && (!level || p.level === level));
  }, [group, level]);

  return (
    <Page title="Программы" sub={`${PROGRAMS.length} программ для зала, дома и улицы`}>
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

      <div className="section-title"><span>Готовые программы</span><span className="faint">{list.length}</span></div>
      {list.map((p) => (
        <Link key={p.id} to={`/programs/${p.id}`} className="card" style={{ display: 'block', color: 'var(--text)' }}>
          <div className="row">
            <div className="thumb">{disciplineIcon(p.discipline)}</div>
            <div className="grow">
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <div className="faint">{p.subtitle}</div>
            </div>
          </div>
          <div className="tags mt">
            <span className="tag accent">{tagLabel('difficulty', p.level)}</span>
            {p.locations.map((l) => <span key={l} className="tag">{tagLabel('location', l)}</span>)}
            {p.sessionsPerWeek && <span className="tag">{p.sessionsPerWeek}×/нед</span>}
            {p.weeks && <span className="tag">{p.weeks} нед</span>}
            <span className="tag">{p.workouts.length} трен.</span>
          </div>
        </Link>
      ))}
      {!list.length && <div className="empty">Нет программ с такими фильтрами</div>}
    </Page>
  );
}

