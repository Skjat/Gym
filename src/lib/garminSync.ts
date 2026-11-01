// Garmin data synced by the GitHub Actions workflow (garmin-sync/sync.py).
// The workflow encrypts the data with AES-256-GCM (key = PBKDF2-SHA256(passphrase))
// and pushes it to the `garmin-data` branch. The app downloads and decrypts it locally.
// Login to Garmin (incl. the 2FA code) is also started from the app: the request is
// encrypted with the same passphrase and handed to the workflow as an input.
import { gunzipSync } from 'fflate';
import type { GarminData, Settings } from '../types';
import { dispatchSync, readDataFile, setSecret } from './github';
import { uid } from './id';

interface EncryptedFile {
  v: number;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  gz?: boolean;
  updatedAt?: string;
}

export interface SyncStatus {
  state: 'ok' | 'need_mfa' | 'mfa_failed' | 'need_login' | 'error';
  message: string;
  requestId?: string | null;
  runId?: string | null;
  at: string;
}

const AUTH_SUFFIX = '\u0000auth-request';
const PBKDF2_ITER = 210_000;

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number, usage: KeyUsage): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
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

export async function encryptJson(obj: unknown, passphrase: string): Promise<EncryptedFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITER, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, iter: PBKDF2_ITER, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), gz: false, updatedAt: new Date().toISOString() };
}

export async function decryptGarminFile(file: EncryptedFile, passphrase: string): Promise<GarminData> {
  const key = await deriveKey(passphrase, fromB64(file.salt), file.iter, 'decrypt');
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.ct)));
  } catch {
    throw new Error('Не удалось расшифровать данные Garmin — проверьте пароль синхронизации.');
  }
  if (file.gz) plain = await gunzip(plain);
  return JSON.parse(new TextDecoder().decode(plain)) as GarminData;
}

export function syncConfigured(s: Settings): boolean {
  return Boolean(s.ghRepo && s.syncPassphrase);
}

export async function fetchGarminData(s: Settings): Promise<GarminData> {
  if (!s.ghRepo) throw new Error('Не указан репозиторий GitHub (владелец/репозиторий).');
  if (!s.syncPassphrase) throw new Error('Не указан пароль синхронизации Garmin.');
  const text = await readDataFile(s, 'garmin.enc.json');
  if (!text) throw new Error('Данных Garmin пока нет — войдите в Garmin в разделе «Профиль → Garmin и пульс».');
  return decryptGarminFile(JSON.parse(text) as EncryptedFile, s.syncPassphrase);
}

export async function readSyncStatus(s: Settings): Promise<SyncStatus | undefined> {
  const text = await readDataFile(s, 'status.json');
  return text ? (JSON.parse(text) as SyncStatus) : undefined;
}

/** A random passphrase for encrypting the synced data (stored on the phone and as a repo secret). */
export function generatePassphrase(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{1,6}/g)!.join('-');
}

export async function saveSyncSecret(s: Settings): Promise<void> {
  if (!s.syncPassphrase) throw new Error('Сначала задайте пароль синхронизации.');
  await setSecret(s, 'GARMIN_SYNC_PASSPHRASE', s.syncPassphrase);
}

async function runAndWait(
  s: Settings,
  inputs: Record<string, string>,
  onStatus: (msg: string) => void,
  waitMessage: string,
): Promise<SyncStatus> {
  const requestId = uid('req');
  await dispatchSync(s, { ...inputs, request_id: requestId });
  onStatus('Запрос отправлен в GitHub Actions…');
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 15_000));
  while (Date.now() - started < 6 * 60_000) {
    try {
      const st = await readSyncStatus(s);
      if (st?.requestId === requestId) return st;
    } catch {
      /* transient — keep polling */
    }
    onStatus(`${waitMessage} ${Math.round((Date.now() - started) / 1000)} с`);
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error('Ответа нет дольше 6 минут. Проверьте вкладку Actions в репозитории GitHub.');
}

/** Step 1 of the phone-only login: e-mail + password. Ends in `ok` or `need_mfa` (code sent by Garmin). */
export async function startGarminLogin(s: Settings, email: string, password: string, onStatus: (m: string) => void): Promise<SyncStatus> {
  const env = await encryptJson({ action: 'login', email: email.trim(), password }, s.syncPassphrase + AUTH_SUFFIX);
  return runAndWait(s, { auth: btoa(JSON.stringify(env)), days: '14' }, onStatus, 'Входим в Garmin…');
}

/** Step 2: the 2FA code from Garmin's e-mail / app. */
export async function submitGarminCode(s: Settings, code: string, onStatus: (m: string) => void): Promise<SyncStatus> {
  const env = await encryptJson({ action: 'mfa', code: code.replace(/\s+/g, '') }, s.syncPassphrase + AUTH_SUFFIX);
  return runAndWait(s, { auth: btoa(JSON.stringify(env)), days: '14' }, onStatus, 'Проверяем код и загружаем данные…');
}

/** Regular sync on demand; resolves with the fresh data. */
export async function syncNow(s: Settings, onStatus: (msg: string) => void): Promise<GarminData> {
  if (!s.ghToken) throw new Error('Для синхронизации по кнопке нужен токен GitHub.');
  const st = await runAndWait(s, { days: '7' }, onStatus, 'Синхронизация…');
  if (st.state !== 'ok') throw new Error(st.message);
  return fetchGarminData(s);
}
