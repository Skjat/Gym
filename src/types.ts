// ───────────────────────── Library ─────────────────────────

export type Measure = 'reps' | 'time' | 'distance';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type Intensity = 'easy' | 'moderate' | 'hard';
export type BlockKind = 'warmup' | 'main' | 'circuit' | 'interval' | 'cooldown';

export interface ExerciseDefaults {
  sets?: number;
  reps?: string;
  durationSec?: number;
  distanceM?: number;
  restSec?: number;
}

export interface Exercise {
  id: string;
  name: string;
  nameEn?: string;
  sanskrit?: string;
  disciplines: string[];
  locations: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  qualities: string[];
  difficulty: Difficulty;
  measure: Measure;
  weighted?: boolean;
  unilateral?: boolean;
  description: string;
  steps: string[];
  tips?: string[];
  mistakes?: string[];
  breathing?: string;
  contraindications?: string;
  variations?: string[];
  /** id in free-exercise-db (public domain) — provides start/end photos */
  fedb?: string | null;
  videoQuery?: string;
  defaults?: ExerciseDefaults;
  hrZone?: number;
  /** where the entry came from */
  source?: 'builtin' | 'fedb' | 'custom' | 'coach';
}

export interface WorkoutItem {
  id: string;
  exerciseId?: string;
  /** display name — used for custom exercises created by the coach */
  name?: string;
  description?: string;
  sets?: number;
  reps?: string;
  durationSec?: number;
  distanceM?: number;
  restSec?: number;
  load?: string;
  tempo?: string;
  side?: 'each';
  hrZone?: number;
  notes?: string;
}

export interface WorkoutBlock {
  id: string;
  title: string;
  kind: BlockKind;
  rounds?: number;
  restBetweenRoundsSec?: number;
  items: WorkoutItem[];
}

export interface WorkoutTemplate {
  id: string;
  title: string;
  focus?: string;
  summary?: string;
  discipline?: string;
  location?: string;
  estimatedMinutes?: number;
  intensity?: Intensity;
  notes?: string;
  blocks: WorkoutBlock[];
  /** set for workouts built by the coach */
  createdBy?: 'coach' | 'user' | 'program';
  createdAt?: string;
  programId?: string;
}

export interface Program {
  id: string;
  title: string;
  subtitle?: string;
  discipline: string;
  locations: string[];
  level: Difficulty;
  goal?: string;
  description?: string;
  weeks?: number;
  sessionsPerWeek?: number;
  equipment?: string[];
  qualities?: string[];
  schedule?: string;
  progression?: string;
  workouts: WorkoutTemplate[];
}

// ───────────────────────── Athlete ─────────────────────────

export interface AthleteProfile {
  name: string;
  sex?: 'male' | 'female';
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  level: Difficulty;
  goals: string;
  injuries: string;
  preferences: string;
  equipment: string[];
  locations: string[];
  sessionsPerWeek?: number;
  sessionMinutes?: number;
  maxHR?: number;
  restingHR?: number;
  zoneMethod: 'maxhr' | 'karvonen';
}

export interface CoachNote {
  id: string;
  date: string;
  category: string;
  text: string;
}

export type ClaudeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  apiKey: string;
  model: ClaudeModel;
  effort: Effort;
  liveTips: 'off' | 'exercise' | '3' | '5' | '10';
  voice: boolean;
  voiceName?: string;
  /** Garmin sync through GitHub Actions */
  ghRepo: string;
  ghBranch: string;
  ghToken: string;
  syncPassphrase: string;
  autoRestTimer: boolean;
}

// ───────────────────────── Sessions ─────────────────────────

export interface HRSample {
  /** seconds from session start */
  t: number;
  bpm: number;
}

export interface SetLog {
  id: string;
  blockId: string;
  itemId: string;
  exerciseId?: string;
  exerciseName: string;
  round: number;
  setIndex: number;
  reps?: number;
  weightKg?: number;
  durationSec?: number;
  distanceM?: number;
  rpe?: number;
  skipped?: boolean;
  /** seconds from session start */
  startedAt: number;
  endedAt: number;
  avgHR?: number;
  maxHR?: number;
}

export interface LiveTip {
  t: number;
  text: string;
  source: 'coach' | 'zone' | 'user';
}

export interface SessionMetrics {
  durationSec: number;
  activeSec?: number;
  avgHR?: number;
  maxHR?: number;
  minHR?: number;
  zoneSec?: number[];
  trimp?: number;
  distanceM?: number;
  avgPaceSecPerKm?: number;
  calories?: number;
  rmssd?: number;
  totalVolumeKg?: number;
  setsDone?: number;
}

export interface WorkoutSession {
  id: string;
  title: string;
  discipline?: string;
  template: WorkoutTemplate;
  startedAt: string;
  endedAt?: string;
  sets: SetLog[];
  hr: HRSample[];
  gps?: { t: number; lat: number; lon: number }[];
  tips: LiveTip[];
  metrics?: SessionMetrics;
  rpe?: number;
  feeling?: string;
  notes?: string;
  analysis?: string;
  analysisAt?: string;
  garminActivityId?: string;
  planDayId?: string;
  hrSource?: 'ble' | 'garmin' | 'file' | 'none';
}

// ───────────────────────── Plan ─────────────────────────

export interface PlanDay {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  discipline?: string;
  intensity?: Intensity | 'rest';
  description?: string;
  workoutId?: string;
  status: 'planned' | 'done' | 'skipped';
  sessionId?: string;
}

export interface TrainingPlan {
  goal?: string;
  notes?: string;
  updatedAt?: string;
  days: PlanDay[];
}

// ───────────────────────── Garmin ─────────────────────────

export interface GarminDaily {
  date: string;
  restingHR?: number;
  hrvLastNight?: number;
  hrvWeeklyAvg?: number;
  hrvStatus?: string;
  sleepSec?: number;
  sleepScore?: number;
  deepSleepSec?: number;
  remSleepSec?: number;
  bodyBatteryHigh?: number;
  bodyBatteryLow?: number;
  bodyBatteryMorning?: number;
  stressAvg?: number;
  steps?: number;
  activeKcal?: number;
  readinessScore?: number;
  readinessLevel?: string;
  trainingStatus?: string;
  acuteLoad?: number;
  vo2max?: number;
}

export interface GarminLap {
  index: number;
  durationSec?: number;
  distanceM?: number;
  avgHR?: number;
  maxHR?: number;
  avgSpeed?: number;
  avgCadence?: number;
}

export interface GarminExerciseSet {
  exercise?: string;
  category?: string;
  reps?: number;
  weightKg?: number;
  durationSec?: number;
  startTime?: string;
}

export interface GarminActivity {
  id: string;
  name: string;
  type: string;
  start: string; // ISO local
  startGMT?: string;
  durationSec: number;
  movingSec?: number;
  distanceM?: number;
  avgHR?: number;
  maxHR?: number;
  calories?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgCadence?: number;
  avgPower?: number;
  elevationGain?: number;
  aerobicTE?: number;
  anaerobicTE?: number;
  trainingLoad?: number;
  zoneSec?: number[];
  laps?: GarminLap[];
  /** [secondsFromStart, hr, speed m/s, cadence] */
  series?: [number, number | null, number | null, number | null][];
  sets?: GarminExerciseSet[];
  source: 'garmin-sync' | 'file';
}

export interface GarminData {
  updatedAt?: string;
  daily: GarminDaily[];
  activities: GarminActivity[];
}

// ───────────────────────── Coach chat ─────────────────────────

export interface ChatDisplayItem {
  id: string;
  role: 'user' | 'assistant' | 'event' | 'error';
  text: string;
  workoutId?: string;
  at: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** frozen at conversation start — never edited afterwards (prompt cache + preserved thinking) */
  system: string;
  model: ClaudeModel;
  /** raw Anthropic API messages, append-only */
  messages: unknown[];
  display: ChatDisplayItem[];
  /** hash of the last athlete context snapshot sent in this conversation */
  lastContextHash?: string;
  kind?: 'chat' | 'analysis';
  sessionId?: string;
}

export interface MediaRef {
  id: string;
  type: 'image' | 'video';
  name: string;
  addedAt: string;
}
