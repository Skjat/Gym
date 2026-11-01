// Minimal GitHub REST client for the Garmin sync setup (works from the phone with a fine-grained token).
import type { Settings } from '../types';
import { fromB64, sealedBox, toB64 } from './sealedBox';

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const WORKFLOW = 'garmin-sync.yml';

export class GitHubError extends Error {}

async function gh(s: Settings, path: string, init: RequestInit = {}, raw = false): Promise<Response> {
  if (!s.ghRepo) throw new GitHubError('Укажите репозиторий GitHub (владелец/имя).');
  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (s.ghToken) headers.Authorization = `Bearer ${s.ghToken}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${s.ghRepo}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new GitHubError('Нет связи с GitHub. Проверьте интернет.');
  }
  return res;
}

function explain(res: Response, what: string): GitHubError {
  if (res.status === 401) return new GitHubError('Токен GitHub неверный или истёк — создайте новый.');
  if (res.status === 403)
    return new GitHubError(`GitHub не разрешил ${what}. Проверьте права токена: Actions и Secrets — «Read and write», Contents — «Read-only».`);
  if (res.status === 404) return new GitHubError(`Не найдено (${what}). Проверьте имя репозитория и что токен выдан именно на него.`);
  return new GitHubError(`GitHub вернул ошибку ${res.status} (${what}).`);
}

export async function checkAccess(s: Settings): Promise<{ defaultBranch: string }> {
  if (!s.ghToken) throw new GitHubError('Вставьте токен GitHub.');
  const repo = await gh(s, '');
  if (!repo.ok) throw explain(repo, 'доступ к репозиторию');
  const { default_branch } = (await repo.json()) as { default_branch: string };
  const wf = await gh(s, `/actions/workflows/${WORKFLOW}`);
  if (!wf.ok) throw explain(wf, 'чтение GitHub Actions');
  const key = await gh(s, '/actions/secrets/public-key');
  if (!key.ok) throw explain(key, 'работу с секретами');
  return { defaultBranch: default_branch };
}

export async function setSecret(s: Settings, name: string, value: string): Promise<void> {
  const keyRes = await gh(s, '/actions/secrets/public-key');
  if (!keyRes.ok) throw explain(keyRes, 'работу с секретами');
  const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };
  const encrypted = toB64(sealedBox(new TextEncoder().encode(value), fromB64(key)));
  const res = await gh(s, `/actions/secrets/${name}`, { method: 'PUT', body: JSON.stringify({ encrypted_value: encrypted, key_id }) });
  if (res.status !== 201 && res.status !== 204) throw explain(res, 'сохранение секрета');
}

export async function dispatchSync(s: Settings, inputs: Record<string, string>): Promise<void> {
  const repo = await gh(s, '');
  if (!repo.ok) throw explain(repo, 'доступ к репозиторию');
  const { default_branch } = (await repo.json()) as { default_branch: string };
  const res = await gh(s, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: default_branch, inputs }),
  });
  if (res.status !== 204) throw explain(res, 'запуск синхронизации');
}

/** A file from the data branch (raw). Returns undefined if it doesn't exist yet. */
export async function readDataFile(s: Settings, name: string): Promise<string | undefined> {
  const res = await gh(s, `/contents/${name}?ref=${encodeURIComponent(s.ghBranch || 'garmin-data')}`, {}, true);
  if (res.status === 404) return undefined;
  if (res.status === 403 && !s.ghToken) throw new GitHubError('GitHub ограничил запросы. Добавьте токен GitHub или попробуйте позже.');
  if (!res.ok) throw explain(res, `чтение ${name}`);
  return res.text();
}
