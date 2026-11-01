// Photos/screenshots for Claude: downscaled to ≤1568 px (Claude's recommended size) and re-encoded as JPEG.
export interface PreparedImage {
  mediaType: 'image/jpeg';
  /** base64 without the data: prefix */
  data: string;
  /** small data URL for the chat bubble */
  thumb: string;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть изображение'));
    };
    img.src = url;
  });
}

function render(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const img = await loadImage(file);
  const full = render(img, 1568, 0.85);
  return { mediaType: 'image/jpeg', data: full.slice(full.indexOf(',') + 1), thumb: render(img, 240, 0.7) };
}

export const MAX_IMAGES = 6;
