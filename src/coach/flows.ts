import { useStore } from '../store/store';
import { newConversation } from './claude';
import { todayISO } from '../lib/format';
import type { Conversation } from '../types';

/** Today's chat (reused within a day so the coach keeps the context of the conversation). */
export function chatForToday(): Conversation {
  const convs = useStore.getState().conversations.filter((c) => (c.kind ?? 'chat') === 'chat');
  const latest = [...convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latest && latest.updatedAt.slice(0, 10) === todayISO()) return latest;
  return newConversation('chat');
}

export const QUICK_PROMPTS = [
  'Тренировка на 30 минут дома без инвентаря',
  'Силовая в зале на всё тело, 60 минут',
  'Лёгкая пробежка на восстановление',
  'Йога для спины, 20 минут',
  'Растяжка после тяжёлого дня',
  'Интервальный бег, хочу прибавить в скорости',
  'Составь план тренировок на неделю',
  'Как я восстановился? Что лучше сделать сегодня?',
];

import { runCoachTurn, type TurnCallbacks } from './claude';
import { sessionSummaryText } from '../lib/session';
import { activityLine } from './context';

/** Post-workout analysis: a dedicated conversation, the result is also stored on the session. */
export async function analyzeSession(sessionId: string, cb: TurnCallbacks = {}): Promise<string> {
  const st = useStore.getState();
  const s = st.sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error('Тренировка не найдена');
  const existing = st.conversations.find((c) => c.kind === 'analysis' && c.sessionId === sessionId);
  const conv = existing ?? newConversation('analysis', `Разбор: ${s.title}`, sessionId);
  const act = s.garminActivityId ? st.garmin.activities.find((a) => a.id === s.garminActivityId) : undefined;
  const extra = [
    '<тренировка>',
    sessionSummaryText(s),
    act ? `Активность Garmin: ${activityLine(act)}` : 'Активность Garmin для этой тренировки не найдена.',
    '</тренировка>',
  ].join('\n');
  const before = useStore.getState().conversations.find((c) => c.id === conv.id)?.display.length ?? 0;
  await runCoachTurn(
    conv.id,
    'Разбери эту тренировку: как прошла (пульс, объём, веса, самочувствие), что получилось и что улучшить. Посмотри детали через инструменты и данные Garmin. Если нужно — скорректируй ближайший план и запиши важное о спортсмене.',
    cb,
    { extraContext: extra },
  );
  const after = useStore.getState().conversations.find((c) => c.id === conv.id);
  // The final assistant message is the analysis (earlier ones are "let me look…" remarks between tool calls).
  const text = [...(after?.display ?? []).slice(before)].reverse().find((d) => d.role === 'assistant')?.text ?? '';
  if (text) {
    const cur = useStore.getState().sessions.find((x) => x.id === sessionId);
    if (cur) useStore.getState().saveSession({ ...cur, analysis: text, analysisAt: new Date().toISOString() });
  }
  return conv.id;
}
