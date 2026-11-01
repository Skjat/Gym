// In-flight coach requests live outside the chat screen, so switching tabs doesn't
// interrupt or hide them: the answer keeps streaming and is there when you come back.
import { create } from 'zustand';
import { useStore } from '../store/store';
import { friendlyError, runCoachTurn } from './claude';
import { uid } from '../lib/id';
import type { PreparedImage } from '../lib/images';

interface Turn {
  status: string;
  stream: string;
  abort: AbortController;
}

interface RuntimeState {
  turns: Record<string, Turn>;
  /** screenshots attached but not sent yet, per conversation */
  attachments: Record<string, PreparedImage[]>;
  setAttachments: (convId: string, list: PreparedImage[]) => void;
}

export const useCoachRuntime = create<RuntimeState>()((set) => ({
  turns: {},
  attachments: {},
  setAttachments: (convId, list) => set((s) => ({ attachments: { ...s.attachments, [convId]: list } })),
}));

function patchTurn(convId: string, patch: Partial<Turn>) {
  useCoachRuntime.setState((s) => (s.turns[convId] ? { turns: { ...s.turns, [convId]: { ...s.turns[convId], ...patch } } } : {}));
}

export function isCoachBusy(convId: string): boolean {
  return !!useCoachRuntime.getState().turns[convId];
}

export async function sendToCoach(convId: string, text: string, images: PreparedImage[] = []): Promise<void> {
  if (isCoachBusy(convId)) return;
  const abort = new AbortController();
  useCoachRuntime.setState((s) => ({ turns: { ...s.turns, [convId]: { status: 'Тренер думает…', stream: '', abort } } }));
  try {
    await runCoachTurn(
      convId,
      text,
      {
        onText: (stream) => patchTurn(convId, { stream }),
        onStatus: (status) => patchTurn(convId, { status }),
        signal: abort.signal,
      },
      { images },
    );
  } catch (e) {
    const msg = friendlyError(e);
    useStore.getState().patchConversation(convId, (c) => ({
      ...c,
      display: [...c.display, { id: uid('d'), role: 'error', text: msg, at: new Date().toISOString() }],
    }));
  } finally {
    useCoachRuntime.setState((s) => {
      const turns = { ...s.turns };
      delete turns[convId];
      return { turns };
    });
  }
}

export function stopCoach(convId: string) {
  useCoachRuntime.getState().turns[convId]?.abort.abort();
}
