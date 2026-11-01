import Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../store/store';
import type { ChatDisplayItem, ClaudeModel, Conversation, Effort, Exercise } from '../types';
import { buildSystemPrompt, LIVE_TIP_SYSTEM, TRANSLATE_SYSTEM } from './prompts';
import { COACH_TOOLS, executeTool } from './tools';
import { turnContext } from './context';
import { hashString, uid } from '../lib/id';
import { humanDate, todayISO } from '../lib/format';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

export class CoachError extends Error {}

function client(): Anthropic {
  const { apiKey } = useStore.getState().settings;
  if (!apiKey) throw new CoachError('Добавьте API-ключ Claude в разделе «Профиль → Настройки».');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 10 * 60 * 1000 });
}

/** Server-side refusal fallback is available on Opus/Sonnet, not on Haiku. */
function fallbackParams(model: ClaudeModel): Partial<Pick<StreamParams, 'betas' | 'fallbacks'>> {
  if (model === 'claude-haiku-5-5') return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

export function friendlyError(e: unknown): string {
  if (e instanceof CoachError) return e.message;
  if (e instanceof Anthropic.APIUserAbortError) return 'Запрос отменён.';
  if (e instanceof Anthropic.AuthenticationError) return 'Неверный API-ключ Claude. Проверьте его в настройках.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'У ключа нет доступа к этой модели или функции.';
  if (e instanceof Anthropic.RateLimitError) return 'Слишком много запросов к Claude — подождите минуту и попробуйте снова.';
  if (e instanceof Anthropic.BadRequestError) {
    const msg = String(e.message);
    if (/credit balance/i.test(msg)) return 'На балансе Anthropic закончились средства. Пополните его на console.anthropic.com.';
    return `Claude отклонил запрос: ${msg}`;
  }
  if (e instanceof Anthropic.InternalServerError) return 'Серверы Claude перегружены. Попробуйте ещё раз через минуту.';
  if (e instanceof Anthropic.APIConnectionError) return 'Нет соединения с Claude. Проверьте интернет.';
  if (e instanceof Anthropic.APIError) return `Ошибка Claude (${e.status ?? '—'}): ${e.message}`;
  return (e as Error)?.message ?? String(e);
}

/**
 * After a mid-output server-side fallback, blocks before the last `fallback` marker that belong
 * to the declined attempt (thinking, tool_use, unpaired server tools) must not be echoed back.
 */
function sanitizeForEcho(content: BetaContentBlock[]): BetaContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback' as BetaContentBlock['type']);
  if (lastFallback < 0) return content;
  return content.filter((b, i) => {
    if (i >= lastFallback) return true;
    return b.type === 'text';
  });
}

function stripThinking(messages: BetaMessageParam[]): BetaMessageParam[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return m;
    const content = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...m, content: content.length ? content : [{ type: 'text', text: '…' }] };
  });
}

function isBindingError(e: unknown): boolean {
  return e instanceof Anthropic.BadRequestError && /signature|bound to a different conversation/i.test(String(e.message));
}

// ───────────────────────── conversations ─────────────────────────

export function newConversation(kind: Conversation['kind'] = 'chat', title?: string, sessionId?: string): Conversation {
  const state = useStore.getState();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: uid('c'),
    title: title ?? `Диалог ${humanDate(todayISO())}`,
    createdAt: now,
    updatedAt: now,
    system: buildSystemPrompt(state),
    model: state.settings.model,
    messages: [],
    display: [],
    kind,
    sessionId,
  };
  state.upsertConversation(conv);
  return conv;
}

function getConv(id: string): Conversation {
  const c = useStore.getState().conversations.find((x) => x.id === id);
  if (!c) throw new CoachError('Диалог не найден.');
  return c;
}

function appendMessage(convId: string, msg: BetaMessageParam, display?: ChatDisplayItem[]) {
  useStore.getState().patchConversation(convId, (c) => ({
    ...c,
    // JSON round-trip keeps key order and drops SDK-internal non-enumerable fields
    messages: [...c.messages, JSON.parse(JSON.stringify(msg))],
    display: display ? [...c.display, ...display] : c.display,
    updatedAt: new Date().toISOString(),
  }));
}

function addDisplay(convId: string, items: ChatDisplayItem[]) {
  useStore.getState().patchConversation(convId, (c) => ({ ...c, display: [...c.display, ...items], updatedAt: new Date().toISOString() }));
}

const disp = (role: ChatDisplayItem['role'], text: string, workoutId?: string): ChatDisplayItem => ({
  id: uid('d'),
  role,
  text,
  workoutId,
  at: new Date().toISOString(),
});

export interface TurnCallbacks {
  onText?: (fullTextSoFar: string) => void;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

/**
 * One user turn of the coach conversation: streams Claude's answer, runs tools until Claude
 * finishes. History is append-only (frozen system prompt, assistant content echoed verbatim)
 * so prompt caching and thinking-block binding stay valid.
 */
export async function runCoachTurn(
  convId: string,
  userText: string,
  cb: TurnCallbacks = {},
  opts: { extraContext?: string; hiddenUserText?: boolean } = {},
): Promise<void> {
  const api = client();
  const state = useStore.getState();
  const conv = getConv(convId);

  // Per-turn context (date, recovery, plan) — only when it changed since the last turn.
  const ctx = turnContext(state);
  const ctxHash = hashString(ctx.replace(/время \d\d:\d\d/, ''));
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [];
  if (ctxHash !== conv.lastContextHash) blocks.push({ type: 'text', text: `<контекст>\n${ctx}\n</контекст>` });
  if (opts.extraContext) blocks.push({ type: 'text', text: opts.extraContext });
  blocks.push({ type: 'text', text: userText });
  useStore.getState().patchConversation(convId, (c) => ({ ...c, lastContextHash: ctxHash }));
  appendMessage(convId, { role: 'user', content: blocks }, opts.hiddenUserText ? [] : [disp('user', userText)]);

  let strippedOnce = false;
  for (let iteration = 0; iteration < 10; iteration++) {
    const { settings } = useStore.getState();
    const current = getConv(convId);
    const params: StreamParams = {
      model: settings.model,
      max_tokens: 32000,
      system: [{ type: 'text', text: current.system, cache_control: { type: 'ephemeral' } }],
      tools: COACH_TOOLS,
      messages: current.messages as BetaMessageParam[],
      thinking: { type: 'adaptive' },
      output_config: { effort: settings.effort },
      cache_control: { type: 'ephemeral' },
      ...fallbackParams(settings.model),
    };

    cb.onStatus?.(iteration === 0 ? 'Тренер думает…' : 'Тренер продолжает…');
    let text = '';
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = api.beta.messages.stream(params, { signal: cb.signal });
      stream.on('text', (delta) => {
        text += delta;
        cb.onText?.(text);
      });
      message = await stream.finalMessage();
    } catch (e) {
      if (isBindingError(e) && !strippedOnce) {
        // History no longer matches the thinking signatures (e.g. edited backup) — recover once.
        strippedOnce = true;
        useStore.getState().patchConversation(convId, (c) => ({ ...c, messages: stripThinking(c.messages as BetaMessageParam[]) }));
        iteration--;
        continue;
      }
      throw e;
    }
    cb.onText?.('');

    const content = sanitizeForEcho(message.content);
    const finalText = content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();

    if (message.stop_reason === 'refusal') {
      // The declined turn is not appended; the conversation stays valid for the next message.
      addDisplay(convId, [disp('error', 'Claude отказался отвечать на этот запрос. Попробуйте переформулировать.')]);
      return;
    }

    appendMessage(convId, { role: 'assistant', content }, finalText ? [disp('assistant', finalText)] : []);

    const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason === 'pause_turn') continue;
    if (!toolUses.length) {
      if (message.stop_reason === 'max_tokens') addDisplay(convId, [disp('error', 'Ответ оборвался из-за лимита длины.')]);
      return;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    const display: ChatDisplayItem[] = [];
    for (const tu of toolUses) {
      if (message.stop_reason === 'max_tokens') {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Вызов оборвался по лимиту длины. Повтори его компактнее.' });
        continue;
      }
      cb.onStatus?.(statusFor(tu.name));
      const out = executeTool(tu.name, tu.input);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      if (out.workoutId) display.push(disp('event', out.event ?? 'Тренировка готова', out.workoutId));
      else if (out.event) display.push(disp('event', out.event));
    }
    appendMessage(convId, { role: 'user', content: results }, display);
  }
  addDisplay(convId, [disp('error', 'Тренер сделал слишком много шагов подряд — остановил, чтобы не тратить токены.')]);
}

function statusFor(tool: string): string {
  switch (tool) {
    case 'create_workout':
      return 'Собираю тренировку…';
    case 'update_training_plan':
      return 'Обновляю план…';
    case 'get_garmin_data':
    case 'get_garmin_activity':
      return 'Смотрю данные Garmin…';
    case 'get_recent_sessions':
    case 'get_session_details':
    case 'get_exercise_history':
      return 'Изучаю историю тренировок…';
    default:
      return 'Работаю с данными…';
  }
}

// ───────────────────────── one-shot helpers ─────────────────────────

async function oneShot(system: string, user: string, effort: Effort, maxTokens = 4000, signal?: AbortSignal): Promise<string> {
  const api = client();
  const { settings } = useStore.getState();
  const msg = await api.beta.messages.create(
    {
      model: settings.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      thinking: { type: 'adaptive' },
      output_config: { effort },
      ...fallbackParams(settings.model),
    },
    { signal },
  );
  if (msg.stop_reason === 'refusal') throw new CoachError('Claude отказался отвечать на этот запрос.');
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Short spoken tip during a workout. */
export function liveTip(snapshot: string, signal?: AbortSignal): Promise<string> {
  return oneShot(LIVE_TIP_SYSTEM, snapshot, 'low', 3000, signal);
}

/** Translate an English free-exercise-db entry into a Russian exercise description. */
export async function translateExercise(ex: Exercise): Promise<Exercise> {
  const raw = await oneShot(
    TRANSLATE_SYSTEM,
    JSON.stringify({ name: ex.nameEn ?? ex.name, steps: ex.steps, muscles: ex.primaryMuscles, equipment: ex.equipment }),
    'low',
    6000,
  );
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const t = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1));
  return {
    ...ex,
    name: t.name ?? ex.name,
    description: t.description ?? ex.description,
    steps: Array.isArray(t.steps) ? t.steps : ex.steps,
    tips: Array.isArray(t.tips) ? t.tips : ex.tips,
    mistakes: Array.isArray(t.mistakes) ? t.mistakes : ex.mistakes,
    breathing: t.breathing ?? ex.breathing,
    videoQuery: t.videoQuery ?? ex.videoQuery,
  };
}
