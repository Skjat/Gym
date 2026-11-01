import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type {
  AthleteProfile,
  CoachNote,
  Conversation,
  Exercise,
  GarminActivity,
  GarminData,
  MediaRef,
  PlanDay,
  Settings,
  TrainingPlan,
  WorkoutSession,
  WorkoutTemplate,
} from '../types';
import type { FlatStep } from '../lib/workoutFlow';
import { setCustomExercises, setFedbExercises } from '../data/library';
import { uid } from '../lib/id';

export interface ActiveWorkout {
  session: WorkoutSession;
  steps: FlatStep[];
  index: number;
  phase: 'ready' | 'work' | 'rest';
  /** epoch ms when the current phase started */
  phaseStart: number;
  /** rest length for the current rest phase */
  restSec: number;
  /** epoch ms when paused */
  pausedAt?: number;
  /** epoch ms of the session start (sessions times are relative to it) */
  t0: number;
}

function defaultRepo(): string {
  if (typeof location !== 'undefined' && location.hostname.endsWith('.github.io')) {
    const owner = location.hostname.split('.')[0];
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (owner && repo) return `${owner}/${repo}`;
  }
  return '';
}

export const DEFAULT_PROFILE: AthleteProfile = {
  name: '',
  level: 'beginner',
  goals: '',
  injuries: '',
  preferences: '',
  equipment: [],
  locations: ['gym', 'home', 'outdoor'],
  zoneMethod: 'maxhr',
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  liveTips: 'exercise',
  voice: true,
  ghRepo: defaultRepo(),
  ghBranch: 'garmin-data',
  ghToken: '',
  syncPassphrase: '',
  autoRestTimer: true,
};

interface PersistedState {
  profile: AthleteProfile;
  coachNotes: CoachNote[];
  settings: Settings;
  sessions: WorkoutSession[];
  plan: TrainingPlan;
  savedWorkouts: WorkoutTemplate[];
  customExercises: Exercise[];
  conversations: Conversation[];
  garmin: GarminData;
  media: Record<string, MediaRef[]>;
  favorites: string[];
  active: ActiveWorkout | null;
  fedbImported: boolean;
}

const PERSIST_KEYS: (keyof PersistedState)[] = [
  'profile',
  'coachNotes',
  'settings',
  'sessions',
  'plan',
  'savedWorkouts',
  'customExercises',
  'conversations',
  'garmin',
  'media',
  'favorites',
  'active',
  'fedbImported',
];

interface Actions {
  hydrate: () => Promise<void>;
  updateProfile: (p: Partial<AthleteProfile>) => void;
  updateSettings: (s: Partial<Settings>) => void;
  addCoachNote: (n: Omit<CoachNote, 'id' | 'date'>) => CoachNote;
  removeCoachNote: (id: string) => void;

  saveSession: (s: WorkoutSession) => void;
  deleteSession: (id: string) => void;

  setActive: (a: ActiveWorkout | null) => void;
  patchActive: (fn: (a: ActiveWorkout) => ActiveWorkout) => void;

  upsertPlanDays: (days: PlanDay[]) => void;
  removePlanDays: (dates: string[]) => void;
  setPlanMeta: (meta: { goal?: string; notes?: string }) => void;
  updatePlanDay: (id: string, patch: Partial<PlanDay>) => void;

  saveWorkout: (w: WorkoutTemplate) => void;
  deleteWorkout: (id: string) => void;
  upsertCustomExercise: (e: Exercise) => void;

  upsertConversation: (c: Conversation) => void;
  patchConversation: (id: string, fn: (c: Conversation) => Conversation) => void;
  deleteConversation: (id: string) => void;

  setGarmin: (g: GarminData) => void;
  addImportedActivities: (acts: GarminActivity[]) => void;

  addMedia: (exerciseId: string, file: Blob, type: 'image' | 'video', name: string) => Promise<void>;
  removeMedia: (exerciseId: string, mediaId: string) => Promise<void>;
  toggleFavorite: (id: string) => void;
  setFedbImported: (list: Exercise[]) => Promise<void>;
  importBackup: (data: Partial<PersistedState>) => void;
}

export type AppState = PersistedState & Actions & { ready: boolean };

export const useStore = create<AppState>()((set, getState) => ({
  ready: false,
  profile: DEFAULT_PROFILE,
  coachNotes: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  plan: { days: [] },
  savedWorkouts: [],
  customExercises: [],
  conversations: [],
  garmin: { daily: [], activities: [] },
  media: {},
  favorites: [],
  active: null,
  fedbImported: false,

  async hydrate() {
    const loaded: Partial<PersistedState> = {};
    await Promise.all(
      PERSIST_KEYS.map(async (k) => {
        try {
          const v = await idbGet(k);
          if (v !== undefined) (loaded as Record<string, unknown>)[k] = v;
        } catch (e) {
          console.warn('idb read failed', k, e);
        }
      }),
    );
    if (loaded.profile) loaded.profile = { ...DEFAULT_PROFILE, ...loaded.profile };
    if (loaded.settings) {
      loaded.settings = { ...DEFAULT_SETTINGS, ...loaded.settings };
      if (!loaded.settings.ghRepo) loaded.settings.ghRepo = DEFAULT_SETTINGS.ghRepo;
    }
    setCustomExercises(loaded.customExercises ?? []);
    if (loaded.fedbImported) {
      const fedb = await idbGet<Exercise[]>('fedbExercises').catch(() => undefined);
      if (fedb) setFedbExercises(fedb);
    }
    set({ ...loaded, ready: true });
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
  },

  updateProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
  updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  addCoachNote: (n) => {
    const note: CoachNote = { ...n, id: uid('note'), date: new Date().toISOString().slice(0, 10) };
    set((s) => ({ coachNotes: [...s.coachNotes, note] }));
    return note;
  },
  removeCoachNote: (id) => set((s) => ({ coachNotes: s.coachNotes.filter((n) => n.id !== id) })),

  saveSession: (sess) =>
    set((s) => {
      const others = s.sessions.filter((x) => x.id !== sess.id);
      return { sessions: [sess, ...others].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
    }),
  deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),

  setActive: (a) => set({ active: a }),
  patchActive: (fn) => set((s) => (s.active ? { active: fn(s.active) } : {})),

  upsertPlanDays: (days) =>
    set((s) => {
      const byDate = new Map(s.plan.days.map((d) => [d.date, d]));
      for (const d of days) {
        const prev = byDate.get(d.date);
        byDate.set(d.date, { ...prev, ...d, id: prev?.id ?? d.id, status: d.status ?? prev?.status ?? 'planned' });
      }
      return {
        plan: {
          ...s.plan,
          updatedAt: new Date().toISOString(),
          days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
        },
      };
    }),
  removePlanDays: (dates) =>
    set((s) => ({ plan: { ...s.plan, days: s.plan.days.filter((d) => !dates.includes(d.date)) } })),
  setPlanMeta: (meta) => set((s) => ({ plan: { ...s.plan, ...meta, updatedAt: new Date().toISOString() } })),
  updatePlanDay: (id, patch) =>
    set((s) => ({ plan: { ...s.plan, days: s.plan.days.map((d) => (d.id === id ? { ...d, ...patch } : d)) } })),

  saveWorkout: (w) => set((s) => ({ savedWorkouts: [w, ...s.savedWorkouts.filter((x) => x.id !== w.id)] })),
  deleteWorkout: (id) => set((s) => ({ savedWorkouts: s.savedWorkouts.filter((x) => x.id !== id) })),
  upsertCustomExercise: (e) =>
    set((s) => {
      const list = [e, ...s.customExercises.filter((x) => x.id !== e.id)];
      setCustomExercises(list);
      return { customExercises: list };
    }),

  upsertConversation: (c) => set((s) => ({ conversations: [c, ...s.conversations.filter((x) => x.id !== c.id)] })),
  patchConversation: (id, fn) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)) })),
  deleteConversation: (id) => set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),

  setGarmin: (g) =>
    set((s) => {
      // keep activities that came from file imports
      const imported = s.garmin.activities.filter((a) => a.source === 'file' && !g.activities.some((x) => x.id === a.id));
      return { garmin: { ...g, activities: [...g.activities, ...imported].sort((a, b) => b.start.localeCompare(a.start)) } };
    }),
  addImportedActivities: (acts) =>
    set((s) => {
      const ids = new Set(acts.map((a) => a.id));
      const merged = [...acts, ...s.garmin.activities.filter((a) => !ids.has(a.id))];
      return { garmin: { ...s.garmin, activities: merged.sort((a, b) => b.start.localeCompare(a.start)) } };
    }),

  async addMedia(exerciseId, file, type, name) {
    const ref: MediaRef = { id: uid('m'), type, name, addedAt: new Date().toISOString() };
    await idbSet(`media:${ref.id}`, file);
    set((s) => ({ media: { ...s.media, [exerciseId]: [...(s.media[exerciseId] ?? []), ref] } }));
  },
  async removeMedia(exerciseId, mediaId) {
    await idbDel(`media:${mediaId}`);
    set((s) => ({ media: { ...s.media, [exerciseId]: (s.media[exerciseId] ?? []).filter((m) => m.id !== mediaId) } }));
  },
  toggleFavorite: (id) =>
    set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
  async setFedbImported(list) {
    await idbSet('fedbExercises', list);
    setFedbExercises(list);
    set({ fedbImported: list.length > 0 });
  },
  importBackup: (data) => {
    const patch: Partial<PersistedState> = {};
    for (const k of PERSIST_KEYS) {
      if (k in data && k !== 'fedbImported' && k !== 'active') (patch as Record<string, unknown>)[k] = data[k];
    }
    if (patch.settings) patch.settings = { ...getState().settings, ...patch.settings };
    if (patch.profile) patch.profile = { ...DEFAULT_PROFILE, ...patch.profile };
    if (patch.customExercises) setCustomExercises(patch.customExercises);
    set(patch);
  },
}));

// ───────────── persistence: each slice is written to IndexedDB when it changes ─────────────

const timers: Partial<Record<keyof PersistedState, ReturnType<typeof setTimeout>>> = {};

useStore.subscribe((state, prev) => {
  if (!state.ready) return;
  for (const k of PERSIST_KEYS) {
    if (state[k] !== prev[k]) {
      clearTimeout(timers[k]);
      timers[k] = setTimeout(() => {
        idbSet(k, useStore.getState()[k]).catch((e) => console.warn('idb write failed', k, e));
      }, k === 'active' ? 1000 : 300);
    }
  }
});

/** Flush pending writes immediately (e.g. when the app goes to background). */
export function flushPersist() {
  const state = useStore.getState();
  if (!state.ready) return;
  for (const k of PERSIST_KEYS) {
    if (timers[k]) {
      clearTimeout(timers[k]);
      delete timers[k];
      idbSet(k, state[k]).catch(() => undefined);
    }
  }
}

export function exportBackup(includeSecrets: boolean): string {
  const s = useStore.getState();
  const data: Partial<PersistedState> & { exportedAt: string; app: string } = {
    app: 'gym-coach',
    exportedAt: new Date().toISOString(),
  };
  for (const k of PERSIST_KEYS) {
    if (k === 'active' || k === 'fedbImported') continue;
    (data as Record<string, unknown>)[k] = s[k];
  }
  if (!includeSecrets && data.settings) {
    data.settings = { ...data.settings, apiKey: '', ghToken: '', syncPassphrase: '' };
  }
  return JSON.stringify(data);
}

export async function loadMediaBlob(id: string): Promise<Blob | undefined> {
  return idbGet<Blob>(`media:${id}`);
}
