import { db, uid } from './db';
import type { NoteImage } from './types';

export function looksLikeImage(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file.name);
}

/** Checks the browser can really display the file, and reads its dimensions. */
async function measure(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Stores the original file, so animated GIFs and full resolution are kept. */
export async function importImage(file: File): Promise<NoteImage> {
  let size: { width: number; height: number };
  try {
    size = await measure(file);
  } catch {
    throw new Error(`"${file.name}" could not be read as an image this browser can show.`);
  }
  const image: NoteImage = {
    id: uid(),
    name: file.name || 'image',
    size: file.size,
    width: size.width,
    height: size.height,
    blob: new Blob([file], { type: file.type || 'image/png' }),
    createdAt: Date.now(),
  };
  await db.images.add(image);
  void navigator.storage?.persist?.();
  return image;
}
