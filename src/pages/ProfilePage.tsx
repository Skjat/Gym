import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Anthropic from '@anthropic-ai/sdk';
import { exportBackup, useStore } from '../store/store';
import { Page, Seg, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { DIFFICULTIES, EQUIPMENT, LOCATIONS } from '../data/taxonomy';
import { effectiveMaxHR, zoneBounds, ZONE_COLORS, ZONE_NAMES } from '../lib/hr';
import { russianVoices, speak, unlockSpeech } from '../lib/speech';
import { friendlyError } from '../coach/claude';
import type { ClaudeModel, Difficulty, Effort, Settings } from '../types';

const MODELS: { id: ClaudeModel; label: string; hint: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'самый умный, ≈$4/$20 за 1 млн токенов' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'быстрее и дешевле, ≈$2/$10' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'самый дешёвый, ≈$0.1/$0.5' },
];

function NumField({ label, value, onChange, placeholder }: { label: string; value?: number; onChange: (v?: number) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" inputMode="numeric" value={value ?? ''} placeholder={placeholder} onChange={(e) => { const n = parseFloat(e.target.value.replace(',', '.')); onChange(isNaN(n) ? undefined : n); }} />
    </label>
  );
}

export default function ProfilePage() {
  const profile = useStore((s) => s.profile);
  const settings = useStore((s) => s.settings);
  const notes = useStore((s) => s.coachNotes);
  const updateProfile = useStore((s) => s.updateProfile);
  const updateSettings = useStore((s) => s.updateSettings);
  const removeCoachNote = useStore((s) => s.removeCoachNote);
  const importBackup = useStore((s) => s.importBackup);
  const garminRest = useStore((s) => [...s.garmin.daily].sort((a, b) => b.date.localeCompare(a.date))[0]?.restingHR);
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bounds = zoneBounds(profile, garminRest);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const checkKey = async () => {
    setChecking(true);
    try {
      const api = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
      const r = await api.messages.create({ model: settings.model, max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Ответь одним словом: «Готов!»' }] });
      const t = r.content.find((b) => b.type === 'text');
      toast(`Claude на связи: ${t && 'text' in t ? t.text : 'ок'}`);
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setChecking(false);
    }
  };

  const download = () => {
    const blob = new Blob([exportBackup(false)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trener-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'gym-coach') throw new Error('Это не резервная копия приложения');
      if (!confirm('Заменить текущие данные данными из копии?')) return;
      importBackup(data);
      toast('Данные восстановлены');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const set = (p: Partial<Settings>) => updateSettings(p);

  return (
    <Page title="Профиль" actions={<Link to="/history" className="btn small"><Icon name="history" size={16} /> История</Link>}>
      <div className="list">
        <Link to="/plan" className="list-item"><div className="thumb">📅</div><div className="grow"><div className="title">План тренировок</div></div><Icon name="chevron" size={18} /></Link>
        <Link to="/garmin" className="list-item"><div className="thumb">⌚</div><div className="grow"><div className="title">Garmin и пульс</div><div className="meta">Синхронизация, файлы, Bluetooth</div></div><Icon name="chevron" size={18} /></Link>
        <Link to="/history" className="list-item"><div className="thumb">📒</div><div className="grow"><div className="title">История тренировок</div></div><Icon name="chevron" size={18} /></Link>
      </div>

      <div className="section-title"><span>Claude</span></div>
      <div className="card">
        <label className="field">
          <span>API-ключ Anthropic (хранится только на этом устройстве)</span>
          <div className="row">
            <input className="input" type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => set({ apiKey: e.target.value.trim() })} placeholder="sk-ant-…" autoComplete="off" />
            <button className="icon-btn" onClick={() => setShowKey(!showKey)}>{showKey ? '🙈' : '👁'}</button>
          </div>
        </label>
        <div className="faint small mb">Ключ создаётся на console.anthropic.com → API Keys. Оплата — по факту использования.</div>
        <div className="field"><span>Модель</span>
          <Seg options={MODELS.map((m) => ({ id: m.id, label: m.label }))} value={settings.model} onChange={(v) => set({ model: v })} />
          <div className="faint small">{MODELS.find((m) => m.id === settings.model)?.hint}</div>
        </div>
        <div className="field"><span>Глубина размышлений</span>
          <Seg options={(['low', 'medium', 'high'] as Effort[]).map((e) => ({ id: e, label: e === 'low' ? 'Быстро' : e === 'medium' ? 'Баланс' : 'Глубоко' }))} value={settings.effort} onChange={(v) => set({ effort: v })} />
        </div>
        <label className="field"><span>Подсказки тренера во время тренировки</span>
          <select className="select" value={settings.liveTips} onChange={(e) => set({ liveTips: e.target.value as Settings['liveTips'] })}>
            <option value="off">Только по кнопке</option>
            <option value="exercise">При смене упражнения</option>
            <option value="3">Каждые 3 минуты</option>
            <option value="5">Каждые 5 минут</option>
            <option value="10">Каждые 10 минут</option>
          </select>
        </label>
        <button className="btn block" onClick={checkKey} disabled={!settings.apiKey || checking}>{checking ? 'Проверяю…' : 'Проверить подключение'}</button>
      </div>

      <div className="section-title"><span>О себе</span></div>
      <div className="card">
        <label className="field"><span>Имя</span><input className="input" value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} /></label>
        <div className="field"><span>Пол</span>
          <Seg options={[{ id: 'male', label: 'Мужской' }, { id: 'female', label: 'Женский' }]} value={profile.sex ?? 'male'} onChange={(v) => updateProfile({ sex: v })} />
        </div>
        <div className="row">
          <div className="grow"><NumField label="Год рождения" value={profile.birthYear} onChange={(v) => updateProfile({ birthYear: v })} /></div>
          <div className="grow"><NumField label="Рост, см" value={profile.heightCm} onChange={(v) => updateProfile({ heightCm: v })} /></div>
          <div className="grow"><NumField label="Вес, кг" value={profile.weightKg} onChange={(v) => updateProfile({ weightKg: v })} /></div>
        </div>
        <div className="field"><span>Уровень подготовки</span>
          <Seg options={DIFFICULTIES.map((d) => ({ id: d.id as Difficulty, label: d.label }))} value={profile.level} onChange={(v) => updateProfile({ level: v })} />
        </div>
        <label className="field"><span>Цели</span><textarea className="textarea" value={profile.goals} onChange={(e) => updateProfile({ goals: e.target.value })} placeholder="Например: пробежать 10 км из 50 минут, подтягиваться 15 раз, сесть в шпагат" /></label>
        <label className="field"><span>Травмы и ограничения</span><textarea className="textarea" value={profile.injuries} onChange={(e) => updateProfile({ injuries: e.target.value })} placeholder="Например: старая травма правого колена, не люблю прыжки" /></label>
        <label className="field"><span>Предпочтения</span><textarea className="textarea" value={profile.preferences} onChange={(e) => updateProfile({ preferences: e.target.value })} placeholder="Что нравится, что нет, когда удобно тренироваться" /></label>
        <div className="row">
          <div className="grow"><NumField label="Тренировок в неделю" value={profile.sessionsPerWeek} onChange={(v) => updateProfile({ sessionsPerWeek: v })} /></div>
          <div className="grow"><NumField label="Минут на тренировку" value={profile.sessionMinutes} onChange={(v) => updateProfile({ sessionMinutes: v })} /></div>
        </div>
        <div className="field"><span>Где тренируюсь</span>
          <div className="chips wrap">
            {LOCATIONS.map((l) => <button key={l.id} className={`chip ${profile.locations.includes(l.id) ? 'on' : 'outline'}`} onClick={() => updateProfile({ locations: toggle(profile.locations, l.id) })}>{l.icon} {l.label}</button>)}
          </div>
        </div>
        <div className="field"><span>Инвентарь, который есть дома / под рукой</span>
          <div className="chips wrap">
            {EQUIPMENT.filter((e) => e.id !== 'none').map((e) => <button key={e.id} className={`chip ${profile.equipment.includes(e.id) ? 'on' : 'outline'}`} onClick={() => updateProfile({ equipment: toggle(profile.equipment, e.id) })}>{e.label}</button>)}
          </div>
        </div>
      </div>

      <div className="section-title"><span>Пульсовые зоны</span></div>
      <div className="card">
        <div className="row">
          <div className="grow"><NumField label="Макс. пульс" value={profile.maxHR} onChange={(v) => updateProfile({ maxHR: v })} placeholder={`≈${effectiveMaxHR(profile)}`} /></div>
          <div className="grow"><NumField label="Пульс покоя" value={profile.restingHR} onChange={(v) => updateProfile({ restingHR: v })} placeholder={garminRest ? `${garminRest} (Garmin)` : '60'} /></div>
        </div>
        <Seg options={[{ id: 'maxhr', label: '% от максимума' }, { id: 'karvonen', label: 'Карвонен (резерв)' }]} value={profile.zoneMethod} onChange={(v) => updateProfile({ zoneMethod: v })} />
        {ZONE_NAMES.map((n, i) => (
          <div key={n} className="row between small" style={{ padding: '3px 0' }}>
            <span><span className="dot" style={{ background: ZONE_COLORS[i] }} /> Z{i + 1} {n}</span>
            <span className="faint">{bounds[i]}–{i < 4 ? bounds[i + 1] - 1 : bounds[5]}</span>
          </div>
        ))}
      </div>

      <div className="section-title"><span>Тренер запомнил</span><span className="faint">{notes.length}</span></div>
      {notes.length ? (
        <div className="list">
          {[...notes].reverse().map((n) => (
            <div key={n.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="grow"><div className="small">{n.text}</div><div className="meta">{n.date} · {n.category}</div></div>
              <button className="icon-btn" onClick={() => removeCoachNote(n.id)}><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card faint small">Тренер сам будет записывать важное: травмы, рабочие веса, предпочтения.</div>
      )}

      <div className="section-title"><span>Голос и таймеры</span></div>
      <div className="card">
        <label className="switch"><span>Голосовые подсказки</span><input type="checkbox" checked={settings.voice} onChange={(e) => set({ voice: e.target.checked })} /></label>
        {russianVoices().length > 1 && (
          <select className="select mt" value={settings.voiceName ?? ''} onChange={(e) => set({ voiceName: e.target.value || undefined })}>
            <option value="">Голос по умолчанию</option>
            {russianVoices().map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        )}
        <label className="switch mt"><span>Таймер отдыха между подходами</span><input type="checkbox" checked={settings.autoRestTimer} onChange={(e) => set({ autoRestTimer: e.target.checked })} /></label>
        <button className="btn small mt" onClick={() => { unlockSpeech(); speak('Привет! Начинаем тренировку.'); }}>Проверить голос</button>
      </div>

      <div className="section-title"><span>Данные</span></div>
      <div className="card">
        <div className="faint small mb">Все данные хранятся только на этом устройстве. Делайте резервную копию — её можно восстановить на другом телефоне.</div>
        <div className="btn-row">
          <button className="btn" onClick={download}>Скачать копию</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Восстановить</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} />
      </div>
      <div className="faint small center mt">Тренер · фото упражнений: free-exercise-db (public domain)</div>
    </Page>
  );
}
