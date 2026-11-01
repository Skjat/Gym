type Sentinel = { release: () => Promise<void> };
let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (wl) sentinel = await wl.request('screen');
  } catch {
    sentinel = null;
  }
}

export async function keepScreenOn(on: boolean) {
  wanted = on;
  if (on) await acquire();
  else {
    await sentinel?.release().catch(() => undefined);
    sentinel = null;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') acquire();
  });
}
