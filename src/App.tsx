import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import { flushPersist, useStore } from './store/store';
import { Icon } from './components/Icon';
import { ToastHost } from './components/ui';
import { configureSpeech } from './lib/speech';
import TodayPage from './pages/TodayPage';
import CoachPage from './pages/CoachPage';
import ProgramsPage from './pages/ProgramsPage';
import ProgramDetailPage from './pages/ProgramDetailPage';
import WorkoutDetailPage from './pages/WorkoutDetailPage';
import ExercisesPage from './pages/ExercisesPage';
import ExerciseDetailPage from './pages/ExerciseDetailPage';
import PlayerPage from './pages/PlayerPage';
import HistoryPage from './pages/HistoryPage';
import SessionDetailPage from './pages/SessionDetailPage';
import ActivityDetailPage from './pages/ActivityDetailPage';
import PlanPage from './pages/PlanPage';
import ProfilePage from './pages/ProfilePage';
import GarminPage from './pages/GarminPage';

const TABS = [
  { to: '/', label: 'Сегодня', icon: 'home', end: true },
  { to: '/coach', label: 'Тренер', icon: 'chat' },
  { to: '/programs', label: 'Программы', icon: 'list' },
  { to: '/exercises', label: 'Упражнения', icon: 'dumbbell' },
  { to: '/profile', label: 'Профиль', icon: 'user' },
];

function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={t.icon} />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ActiveBanner() {
  const active = useStore((s) => s.active);
  const loc = useLocation();
  if (!active || loc.pathname === '/player') return null;
  return (
    <Link
      to="/player"
      style={{
        position: 'fixed', left: 12, right: 12, zIndex: 25,
        bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 10px)',
        background: 'var(--accent)', color: '#fff', borderRadius: 16, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      }}
    >
      <Icon name="play" fill /> <span className="grow ellipsis">Идёт: {active.session.title}</span> <span>Вернуться</span>
    </Link>
  );
}

function Shell() {
  const loc = useLocation();
  const inPlayer = loc.pathname === '/player';
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className={inPlayer ? '' : 'app'}>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/coach" element={<CoachPage />} />
        <Route path="/coach/:id" element={<CoachPage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/programs/:id" element={<ProgramDetailPage />} />
        <Route path="/workout/:id" element={<WorkoutDetailPage />} />
        <Route path="/exercises" element={<ExercisesPage />} />
        <Route path="/exercises/:id" element={<ExerciseDetailPage />} />
        <Route path="/player" element={<PlayerPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/session/:id" element={<SessionDetailPage />} />
        <Route path="/activity/:id" element={<ActivityDetailPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/garmin" element={<GarminPage />} />
        <Route path="*" element={<TodayPage />} />
      </Routes>
      <ActiveBanner />
      {!inPlayer && <TabBar />}
      <ToastHost />
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const voice = useStore((s) => s.settings.voice);
  const voiceName = useStore((s) => s.settings.voiceName);
  useEffect(() => {
    useStore.getState().hydrate();
    const onHide = () => document.visibilityState === 'hidden' && flushPersist();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPersist);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPersist);
    };
  }, []);
  useEffect(() => {
    configureSpeech(voice, voiceName);
  }, [voice, voiceName]);
  if (!ready) return <div className="empty" style={{ paddingTop: '40vh' }}>Загрузка…</div>;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
