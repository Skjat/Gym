// Garmin data synced by the GitHub Actions workflow (garmin-sync/sync.py).
// The workflow encrypts the data with AES-256-GCM (key = PBKDF2-SHA256(passphrase))
// and pushes it to the `garmin-data` branch. The app downloads and decrypts it locally.
import { gunzipSync } from 'fflate';
import type { GarminData, Settings } from '../types';

interface EncryptedFile {
  v: number;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  gz?: boolean;
  updatedAt?: string;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return gunzipSync(data);
}

export async function decryptGarminFile(file: EncryptedFile, passphrase: string): Promise<GarminData> {
  const key = await deriveKey(passphrase, b64(file.salt), file.iter);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(file.iv) }, key, b64(file.ct)));
  } catch {
    throw new Error('Не удалось расшифровать данные Garmin — проверьте пароль синхронизации.');
  }
  if (file.gz) plain = await gunzip(plain);
  return JSON.parse(new TextDecoder().decode(plain)) as GarminData;
}

function ghHeaders(token: string, raw = false): HeadersInit {
  const h: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function syncConfigured(s: Settings): boolean {
  return Boolean(s.ghRepo && s.syncPassphrase);
}

export async function fetchGarminData(s: Settings): Promise<GarminData> {
  if (!s.ghRepo) throw new Error('Не указан репозиторий GitHub (владелец/репозиторий).');
  if (!s.syncPassphrase) throw new Error('Не указан пароль синхронизации Garmin.');
  const url = `https://api.github.com/repos/${s.ghRepo}/contents/garmin.enc.json?ref=${encodeURIComponent(s.ghBranch || 'garmin-data')}`;
  const res = await fetch(url, { headers: ghHeaders(s.ghToken, true), cache: 'no-store' });
  if (res.status === 404) throw new Error('Данные ещё не синхронизированы: запустите workflow «Garmin sync» в GitHub Actions.');
  if (res.status === 403) throw new Error('GitHub ограничил запросы. Добавьте токен GitHub в настройках или попробуйте позже.');
  if (!res.ok) throw new Error(`GitHub вернул ошибку ${res.status}`);
  const file = (await res.json()) as EncryptedFile;
  return decryptGarminFile(file, s.syncPassphrase);
}

/** Starts the sync workflow right now (needs a fine-grained token with Actions: write). */
export async function triggerGarminSync(s: Settings, days = 7): Promise<void> {
  if (!s.ghToken) throw new Error('Для запуска синхронизации по кнопке нужен токен GitHub (Actions: Read and write).');
  const repoRes = await fetch(`https://api.github.com/repos/${s.ghRepo}`, { headers: ghHeaders(s.ghToken) });
  if (!repoRes.ok) throw new Error(`Не удалось получить репозиторий (${repoRes.status})`);
  const repo = (await repoRes.json()) as { default_branch: string };
  const res = await fetch(`https://api.github.com/repos/${s.ghRepo}/actions/workflows/garmin-sync.yml/dispatches`, {
    method: 'POST',
    headers: { ...ghHeaders(s.ghToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: repo.default_branch, inputs: { days: String(days) } }),
  });
  if (res.status !== 204) throw new Error(`Не удалось запустить синхронизацию (${res.status}). Проверьте права токена.`);
}

/** Trigger, then poll until a newer file appears (up to ~4 minutes). */
export async function syncNow(
  s: Settings,
  previousUpdatedAt: string | undefined,
  onStatus: (msg: string) => void,
): Promise<GarminData> {
  await triggerGarminSync(s);
  onStatus('Синхронизация запущена в GitHub Actions…');
  const started = Date.now();
  while (Date.now() - started < 240_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const data = await fetchGarminData(s);
      if (data.updatedAt && data.updatedAt !== previousUpdatedAt) return data;
      onStatus(`Ждём данные от Garmin… ${Math.round((Date.now() - started) / 1000)} с`);
    } catch (e) {
      onStatus(String((e as Error).message));
    }
  }
  throw new Error('Синхронизация идёт дольше обычного. Проверьте вкладку Actions в GitHub.');
}
