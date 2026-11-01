import { useEffect, useRef, useState } from 'react';
import type { Exercise, MediaRef } from '../types';
import { exerciseImages, videoSearchUrl } from '../data/library';
import { disciplineIcon } from '../data/taxonomy';
import { loadMediaBlob, useStore } from '../store/store';
import { Icon } from './Icon';
import { toast } from './ui';

/**
 * Start/end photos alternate like a simple animation of the movement.
 * Both frames are preloaded eagerly and shown in a single <img> whose src switches —
 * Safari never loaded the hidden (opacity 0, loading="lazy") second frame of the old stacked version.
 */
export function FramePlayer({ urls, compact }: { urls: string[]; compact?: boolean }) {
  const key = urls.join('|');
  const [loaded, setLoaded] = useState<string[] | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setFrame(0);
    Promise.all(
      urls.map(
        (u) =>
          new Promise<string | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(u);
            img.onerror = () => resolve(null);
            img.src = u;
          }),
      ),
    ).then((list) => {
      if (!cancelled) setLoaded(list.filter((u): u is string => !!u));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const count = loaded?.length ?? 0;
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % count), 1100);
    return () => clearInterval(t);
  }, [count]);

  if (!urls.length || (loaded && !loaded.length)) return null;
  const cls = `media ${compact ? 'player-media' : ''}`;
  if (!loaded) {
    return (
      <div className={cls}>
        <span className="faint small">Загрузка фото…</span>
      </div>
    );
  }
  const src = loaded[frame % loaded.length];
  return (
    <div className={cls}>
      <img src={src} alt="" decoding="sync" />
      {loaded.length > 1 && <span className="frame-tag">{urls.indexOf(src) === 0 ? 'Исходное положение' : 'Конечное положение'}</span>}
    </div>
  );
}

function UserMedia({ id, type }: { id: string; type: 'image' | 'video' }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    loadMediaBlob(id).then((b) => {
      if (b) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (!url) return <div className="media"><span className="faint">Загрузка…</span></div>;
  return (
    <div className="media" style={{ background: '#000' }}>
      {type === 'video' ? <video src={url} controls playsInline loop /> : <img src={url} alt="" />}
    </div>
  );
}

const NO_MEDIA: MediaRef[] = [];

export function ExerciseMedia({ ex, compact }: { ex: Exercise; compact?: boolean }) {
  const images = exerciseImages(ex);
  const media = useStore((s) => s.media[ex.id] ?? NO_MEDIA);
  const addMedia = useStore((s) => s.addMedia);
  const removeMedia = useStore((s) => s.removeMedia);
  const [sel, setSel] = useState<string | 'photos'>(images.length ? 'photos' : media[0]?.id ?? 'photos');
  const fileRef = useRef<HTMLInputElement>(null);
  const current = media.find((m) => m.id === sel);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const type = f.type.startsWith('video') ? 'video' : 'image';
    if (f.size > 150 * 1024 * 1024) return toast('Файл больше 150 МБ — выберите покороче');
    await addMedia(ex.id, f, type, f.name);
    toast(type === 'video' ? 'Видео добавлено' : 'Фото добавлено');
  };

  return (
    <div>
      {current ? (
        <UserMedia id={current.id} type={current.type} />
      ) : images.length ? (
        <FramePlayer urls={images} compact={compact} />
      ) : (
        <div className={`media ${compact ? 'player-media' : ''}`} style={{ background: 'var(--bg3)' }}>
          <span className="ph">{disciplineIcon(ex.disciplines[0])}</span>
        </div>
      )}
      {!compact && (
        <>
          {(media.length > 0 || images.length > 0) && (
            <div className="media-strip">
              {images.length > 0 && (
                <div className="thumb" onClick={() => setSel('photos')} style={{ outline: sel === 'photos' ? '2px solid var(--accent)' : 'none' }}>
                  <img src={images[0]} alt="" />
                </div>
              )}
              {media.map((m) => (
                <div key={m.id} className="thumb" onClick={() => setSel(m.id)} style={{ outline: sel === m.id ? '2px solid var(--accent)' : 'none' }}>
                  {m.type === 'video' ? '🎬' : '🖼️'}
                </div>
              ))}
            </div>
          )}
          <div className="btn-row mb">
            <a className="btn small" href={videoSearchUrl(ex)} target="_blank" rel="noreferrer">
              <Icon name="video" size={18} /> Видео техники
            </a>
            <button className="btn small" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={18} /> Своё фото/видео
            </button>
            {current && (
              <button
                className="btn small danger"
                onClick={async () => {
                  await removeMedia(ex.id, current.id);
                  setSel('photos');
                }}
              >
                <Icon name="trash" size={18} />
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </>
      )}
    </div>
  );
}

export function ExerciseThumb({ ex }: { ex?: Exercise }) {
  const img = exerciseImages(ex)[0];
  const [failed, setFailed] = useState(false);
  return <div className="thumb">{img && !failed ? <img src={img} alt="" loading="lazy" onError={() => setFailed(true)} /> : disciplineIcon(ex?.disciplines[0])}</div>;
}
