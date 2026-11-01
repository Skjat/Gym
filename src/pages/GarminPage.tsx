import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { Page, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { duration, humanDate, humanDateTime } from '../lib/format';
import { syncNow } from '../lib/garminSync';
import { refreshGarmin, applyGarminData, linkSessions } from '../lib/garminLink';
import { bleSupported, hrMonitor } from '../lib/ble';
import { importActivityFile } from '../lib/fileImport';
import type { Settings } from '../types';

export default function GarminPage() {
  const settings = useStore((s) => s.settings);
  const garmin = useStore((s) => s.garmin);
  const updateSettings = useStore((s) => s.updateSettings);
  const addImported = useStore((s) => s.addImportedActivities);
  const [busy, setBusy] = useState('');
  const [bpm, setBpm] = useState<number>();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Settings>) => updateSettings(p);
  const daily = [...garmin.daily].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);

  const load = async () => {
    setBusy('Загружаю…');
    try {
      const d = await refreshGarmin();
      toast(`Загружено: ${d.daily.length} дн., ${d.activities.length} активностей`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const sync = async () => {
    setBusy('Запускаю синхронизацию…');
    try {
      const d = await syncNow(settings, garmin.updatedAt, setBusy);
      applyGarminData(d);
      toast('Garmin синхронизирован');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

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

  return (
    <Page back title="Garmin" sub={garmin.updatedAt ? `Синхронизировано ${humanDateTime(garmin.updatedAt)}` : 'Подключение часов'}>
      <div className="card">
        <h2>1. Автосинхронизация</h2>
        <div className="faint small mb">
          Каждые 3 часа GitHub Actions забирает из Garmin Connect сон, HRV, Body Battery, пульс покоя, готовность и тренировки (с пульсом, темпом, кругами и подходами), шифрует их вашим паролем и кладёт в ветку <code>garmin-data</code>. Приложение скачивает и расшифровывает их на телефоне. Настройка — в README репозитория.
        </div>
        <label className="field"><span>Репозиторий GitHub (владелец/имя)</span><input className="input" value={settings.ghRepo} onChange={(e) => set({ ghRepo: e.target.value.trim() })} placeholder="Skjat/Gym" /></label>
        <label className="field"><span>Пароль синхронизации (как секрет GARMIN_SYNC_PASSPHRASE)</span><input className="input" type="password" value={settings.syncPassphrase} onChange={(e) => set({ syncPassphrase: e.target.value })} autoComplete="off" /></label>
        <label className="field"><span>Токен GitHub — необязательно, для кнопки «Синхронизировать сейчас» (Actions: Read and write)</span><input className="input" type="password" value={settings.ghToken} onChange={(e) => set({ ghToken: e.target.value.trim() })} placeholder="github_pat_…" autoComplete="off" /></label>
        <div className="btn-row">
          <button className="btn primary" onClick={load} disabled={!!busy || !settings.ghRepo || !settings.syncPassphrase}><Icon name="refresh" size={18} /> Загрузить данные</button>
          <button className="btn" onClick={sync} disabled={!!busy || !settings.ghToken}>Синхронизировать сейчас</button>
        </div>
        {busy && <div className="faint small mt">{busy}</div>}
      </div>

      {daily.length > 0 && (
        <div className="card">
          <h2>Последние дни</h2>
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

      <div className="card">
        <h2>2. Живой пульс во время тренировки</h2>
        <div className="faint small mb">
          На часах: Настройки → Датчики и аксессуары → Пульс на запястье → «Трансляция пульса» (или «Трансляция во время активности»). Safari на iPhone не умеет Bluetooth, поэтому для живого пульса откройте приложение в бесплатном браузере <b>Bluefy</b>. Тогда тренер будет видеть пульс и зоны прямо во время тренировки.
        </div>
        {bleSupported() ? (
          <button className="btn block" onClick={connectHR}><Icon name="bt" size={18} /> {hrMonitor.status === 'connected' ? `Подключено: ${hrMonitor.deviceName}${bpm ? ` · ${bpm} уд/мин` : ''}` : 'Подключить пульс'}</button>
        ) : (
          <div className="tag yellow">В этом браузере Bluetooth недоступен</div>
        )}
      </div>

      <div className="card">
        <h2>3. Импорт файла тренировки</h2>
        <div className="faint small mb">Garmin Connect (сайт) → активность → ⚙ → «Экспорт оригинала» (.zip/.fit) или «Экспорт в TCX/GPX». Затем выберите файл здесь — тренировка привяжется к записи в приложении по времени.</div>
        <button className="btn block" onClick={() => fileRef.current?.click()}><Icon name="plus" size={18} /> Выбрать файл</button>
        <input ref={fileRef} type="file" multiple accept=".fit,.tcx,.gpx,.zip,application/zip,application/octet-stream,application/xml" hidden onChange={(e) => onFiles(e.target.files)} />
      </div>
    </Page>
  );
}
