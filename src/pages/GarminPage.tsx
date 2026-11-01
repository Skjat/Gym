import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { Page, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { duration, humanDate, humanDateTime } from '../lib/format';
import { generatePassphrase, readSyncStatus, saveSyncSecret, startGarminLogin, submitGarminCode, syncNow, type SyncStatus } from '../lib/garminSync';
import { checkAccess, TOKEN_URL } from '../lib/github';
import { refreshGarmin, applyGarminData, linkSessions } from '../lib/garminLink';
import { bleSupported, hrMonitor } from '../lib/ble';
import { importActivityFile } from '../lib/fileImport';
import type { Settings } from '../types';

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 0', borderTop: n > 1 ? '0.5px solid var(--sep)' : undefined }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="badge" style={{ background: done ? 'var(--green)' : 'var(--accent)' }}>{done ? '✓' : n}</span>
        <b>{title}</b>
      </div>
      {children}
    </div>
  );
}

export default function GarminPage() {
  const settings = useStore((s) => s.settings);
  const garmin = useStore((s) => s.garmin);
  const updateSettings = useStore((s) => s.updateSettings);
  const addImported = useStore((s) => s.addImportedActivities);
  const set = (p: Partial<Settings>) => updateSettings(p);
  const [busy, setBusy] = useState('');
  const [tokenOk, setTokenOk] = useState(false);
  const [secretSaved, setSecretSaved] = useState(!!settings.syncPassphrase && !!settings.garminConnected);
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState(settings.garminEmail ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<SyncStatus | undefined>();
  const [manual, setManual] = useState(false);
  const [setupOpen, setSetupOpen] = useState(!(settings.garminConnected && settings.syncPassphrase));
  const [bpm, setBpm] = useState<number>();
  const fileRef = useRef<HTMLInputElement>(null);
  const daily = [...garmin.daily].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const waitingCode = status?.state === 'need_mfa' || status?.state === 'mfa_failed';

  // Pick up a login that is waiting for the 2FA code (e.g. the app was closed meanwhile).
  useEffect(() => {
    if (!settings.ghToken || !settings.ghRepo) return;
    readSyncStatus(settings)
      .then((st) => {
        if (st && Date.now() - new Date(st.at).getTime() < 30 * 60_000) setStatus(st);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const verifyToken = () =>
    run('Проверяю доступ…', async () => {
      await checkAccess(useStore.getState().settings);
      setTokenOk(true);
      toast('Доступ к репозиторию есть');
    });

  const savePassphrase = () =>
    run('Сохраняю пароль в GitHub…', async () => {
      let pass = useStore.getState().settings.syncPassphrase;
      if (!pass) {
        pass = generatePassphrase();
        set({ syncPassphrase: pass });
      }
      await saveSyncSecret({ ...useStore.getState().settings, syncPassphrase: pass });
      setSecretSaved(true);
      toast('Пароль синхронизации сохранён в GitHub');
    });

  const afterStatus = async (st: SyncStatus) => {
    setStatus(st);
    if (st.state === 'ok') {
      set({ garminConnected: true });
      setSetupOpen(false);
      setPassword('');
      setCode('');
      await refreshGarmin();
      toast('Garmin подключён, данные загружены');
    } else if (st.state === 'need_mfa') {
      toast('Garmin прислал код подтверждения');
    } else {
      toast(st.message);
    }
  };

  const login = () =>
    run('Входим в Garmin…', async () => {
      set({ garminEmail: email.trim() });
      const st = await startGarminLogin(useStore.getState().settings, email, password, setBusy);
      await afterStatus(st);
    });

  const sendCode = () =>
    run('Проверяем код…', async () => {
      const st = await submitGarminCode(useStore.getState().settings, code, setBusy);
      await afterStatus(st);
    });

  const load = () =>
    run('Загружаю…', async () => {
      const d = await refreshGarmin();
      toast(`Загружено: ${d.daily.length} дн., ${d.activities.length} активностей`);
    });

  const sync = () =>
    run('Запускаю синхронизацию…', async () => {
      const d = await syncNow(useStore.getState().settings, setBusy);
      applyGarminData(d);
      toast('Garmin синхронизирован');
    });

  const connectHR = async () => {
    try {
      await hrMonitor.connect();
      hrMonitor.onReading((r) => setBpm(r.bpm));
      toast(`Подключено: ${hrMonitor.deviceName}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let n = 0;
    for (const f of Array.from(files)) {
      try {
        const list = await importActivityFile(f);
        addImported(list);
        n += list.length;
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    linkSessions(useStore.getState().garmin.activities);
    if (n) toast(`Импортировано: ${n}`);
  };

  const connected = settings.garminConnected && settings.syncPassphrase;

  return (
    <Page back title="Garmin" sub={garmin.updatedAt ? `Синхронизировано ${humanDateTime(garmin.updatedAt)}` : connected ? 'Подключено' : 'Подключение часов'}>
      {connected && !setupOpen && !waitingCode && (
        <div className="card row">
          <div className="thumb">⌚</div>
          <div className="grow">
            <h3 style={{ margin: 0 }}>Garmin подключён</h3>
            <div className="faint small">{settings.garminEmail ? `${settings.garminEmail} · ` : ''}синхронизация каждые 3 часа</div>
          </div>
          <button className="btn small" onClick={() => setSetupOpen(true)}>Настроить</button>
        </div>
      )}
      {(setupOpen || waitingCode) && (
      <div className="card">
        <h2>Подключение — прямо с телефона</h2>
        <div className="faint small mb">
          Каждые 3 часа GitHub Actions забирает из Garmin Connect сон, HRV, Body Battery, пульс покоя, готовность и тренировки с пульсом, темпом и подходами. Данные шифруются паролем синхронизации; расшифровываются только на этом телефоне.
        </div>

        <Step n={1} title="Токен GitHub" done={tokenOk || !!connected}>
          <ol className="steps small" style={{ marginBottom: 10 }}>
            <li>
              Откройте <a href={TOKEN_URL} target="_blank" rel="noreferrer">страницу создания токена</a> (войдите в GitHub, если попросит).
            </li>
            <li>Token name — любое, Expiration — максимальный срок.</li>
            <li>Repository access → <b>Only select repositories</b> → {settings.ghRepo || 'ваш репозиторий'}.</li>
            <li>
              Permissions → Repository: <b>Actions</b> — Read and write, <b>Secrets</b> — Read and write, <b>Contents</b> — Read-only.
            </li>
            <li>Generate token → скопируйте и вставьте сюда.</li>
          </ol>
          <label className="field"><span>Репозиторий</span><input className="input" value={settings.ghRepo} onChange={(e) => set({ ghRepo: e.target.value.trim() })} placeholder="Skjat/Gym" /></label>
          <label className="field"><span>Токен</span><input className="input" type="password" value={settings.ghToken} onChange={(e) => { set({ ghToken: e.target.value.trim() }); setTokenOk(false); }} placeholder="github_pat_…" autoComplete="off" /></label>
          <button className="btn block" onClick={verifyToken} disabled={!!busy || !settings.ghToken}>Проверить доступ</button>
        </Step>

        <Step n={2} title="Пароль синхронизации" done={secretSaved || !!connected}>
          <div className="faint small mb">Приложение само придумает надёжный пароль и сохранит его на телефоне и в секретах GitHub. Запишите его — он понадобится, если поставите приложение на другое устройство.</div>
          {settings.syncPassphrase && (
            <div className="row mb">
              <code className="grow" style={{ fontSize: 14, wordBreak: 'break-all' }}>{showPass ? settings.syncPassphrase : '••••••••••••••••'}</code>
              <button className="btn small" onClick={() => setShowPass(!showPass)}>{showPass ? 'Скрыть' : 'Показать'}</button>
            </div>
          )}
          <button className="btn block" onClick={savePassphrase} disabled={!!busy || !settings.ghToken}>
            {settings.syncPassphrase ? (secretSaved ? 'Сохранить в GitHub ещё раз' : 'Сохранить в GitHub') : 'Создать и сохранить в GitHub'}
          </button>
        </Step>

        <Step n={3} title="Вход в Garmin" done={!!connected && !waitingCode}>
          {!waitingCode ? (
            <>
              <label className="field"><span>Почта Garmin Connect</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="field"><span>Пароль Garmin Connect</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <div className="faint small mb">Пароль не сохраняется: он зашифрованным уходит в синхронизацию один раз, дальше она работает по токенам Garmin. Вход занимает около минуты.</div>
              <button className="btn primary block" onClick={login} disabled={!!busy || !email.trim() || !password || !settings.ghToken || !settings.syncPassphrase}>
                {connected ? 'Войти заново' : 'Войти в Garmin'}
              </button>
            </>
          ) : (
            <>
              <div className={`small mb ${status?.state === 'mfa_failed' ? 'accent' : ''}`}>{status?.message}</div>
              <label className="field"><span>Код подтверждения от Garmin</span>
                <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" style={{ fontSize: 24, letterSpacing: 4, textAlign: 'center' }} />
              </label>
              <button className="btn primary block" onClick={sendCode} disabled={!!busy || code.replace(/\s/g, '').length < 4}>Подтвердить</button>
              <button className="btn block mt" onClick={() => setStatus(undefined)} disabled={!!busy}>Начать вход заново</button>
            </>
          )}
          {status && !waitingCode && status.state !== 'ok' && <div className="tag red mt">{status.message}</div>}
        </Step>
      </div>
      )}
      {busy && <div className="tip mb small"><span className="typing"><i /><i /><i /></span> {busy}</div>}

      {connected && (
        <div className="card">
          <h2>Синхронизация</h2>
          <div className="btn-row">
            <button className="btn primary" onClick={load} disabled={!!busy}><Icon name="refresh" size={18} /> Загрузить данные</button>
            <button className="btn" onClick={sync} disabled={!!busy || !settings.ghToken}>Синхронизировать сейчас</button>
          </div>
          {daily.length > 0 && (
            <div className="mt">
              {daily.map((d) => (
                <div key={d.date} className="small" style={{ padding: '5px 0', borderBottom: '0.5px solid var(--sep)' }}>
                  <b>{humanDate(d.date)}</b>{' '}
                  <span className="muted">
                    {[d.sleepSec && `сон ${duration(d.sleepSec)}`, d.hrvLastNight && `HRV ${d.hrvLastNight}`, d.restingHR && `ЧСС покоя ${d.restingHR}`, (d.bodyBatteryMorning ?? d.bodyBatteryHigh) && `BB ${d.bodyBatteryMorning ?? d.bodyBatteryHigh}`, d.readinessScore && `готовность ${d.readinessScore}`, d.steps && `${d.steps} шагов`].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="row between" onClick={() => setManual(!manual)} style={{ cursor: 'pointer' }}>
          <h2 style={{ margin: 0 }}>Уже настроено на другом устройстве?</h2>
          <Icon name={manual ? 'close' : 'chevron'} size={18} />
        </div>
        {manual && (
          <div className="mt">
            <div className="faint small mb">Введите тот же пароль синхронизации — данные расшифруются на этом устройстве. Токен GitHub нужен только для входа и синхронизации по кнопке.</div>
            <label className="field"><span>Пароль синхронизации</span><input className="input" type="password" value={settings.syncPassphrase} onChange={(e) => set({ syncPassphrase: e.target.value })} autoComplete="off" /></label>
            <button className="btn block" onClick={() => run('Загружаю…', async () => { await refreshGarmin(); set({ garminConnected: true }); setSetupOpen(false); setManual(false); toast('Данные Garmin загружены'); })} disabled={!!busy || !settings.syncPassphrase || !settings.ghRepo}>Загрузить данные</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Скриншоты — без настройки</h2>
        <div className="faint small">Можно ничего не подключать: присылайте тренеру скриншоты тренировки из приложения Garmin Connect (кнопка 📎 в чате или «Приложить скриншоты из Garmin» в разборе тренировки).</div>
      </div>

      <div className="card">
        <h2>Живой пульс во время тренировки</h2>
        <div className="faint small mb">
          На часах: Настройки → Датчики и аксессуары → Пульс на запястье → «Трансляция пульса». Safari на iPhone не умеет Bluetooth, поэтому для живого пульса откройте приложение в бесплатном браузере <b>Bluefy</b>.
        </div>
        {bleSupported() ? (
          <button className="btn block" onClick={connectHR}><Icon name="bt" size={18} /> {hrMonitor.status === 'connected' ? `Подключено: ${hrMonitor.deviceName}${bpm ? ` · ${bpm} уд/мин` : ''}` : 'Подключить пульс'}</button>
        ) : (
          <div className="tag yellow">В этом браузере Bluetooth недоступен</div>
        )}
      </div>

      <div className="card">
        <h2>Импорт файла тренировки</h2>
        <div className="faint small mb">Garmin Connect (сайт) → активность → ⚙ → «Экспорт оригинала» (.zip/.fit) или «Экспорт в TCX/GPX».</div>
        <button className="btn block" onClick={() => fileRef.current?.click()}><Icon name="plus" size={18} /> Выбрать файл</button>
        <input ref={fileRef} type="file" multiple accept=".fit,.tcx,.gpx,.zip,application/zip,application/octet-stream,application/xml" hidden onChange={(e) => onFiles(e.target.files)} />
      </div>
    </Page>
  );
}
