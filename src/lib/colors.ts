// Android keeps the same table in Theme.kt.
type Hsl = [number, number, number];

export const HUES = [
  { id: 'rose', label: 'Rose', h: 345 },
  { id: 'red', label: 'Red', h: 5 },
  { id: 'orange', label: 'Orange', h: 24 },
  { id: 'amber', label: 'Amber', h: 42 },
  { id: 'lime', label: 'Lime', h: 80 },
  { id: 'green', label: 'Green', h: 130 },
  { id: 'teal', label: 'Teal', h: 172 },
  { id: 'cyan', label: 'Cyan', h: 195 },
  { id: 'blue', label: 'Blue', h: 215 },
  { id: 'indigo', label: 'Indigo', h: 240 },
  { id: 'violet', label: 'Violet', h: 268 },
  { id: 'gray', label: 'Gray', h: 40, gray: true },
];

/** [saturation, lightness] per theme. Dark shades stay dark enough for the night ink, light ones for the day ink. */
export const PALETTES = [
  { id: 'soft', label: 'Soft', light: [70, 92], dark: [25, 18] },
  { id: 'vivid', label: 'Vivid', light: [80, 82], dark: [45, 24] },
  { id: 'deep', label: 'Deep', light: [65, 70], dark: [55, 28] },
];

export function noteShades(id: string | null | undefined): { light: Hsl; dark: Hsl } | null {
  if (!id) return null;
  const palette = PALETTES.find((p) => id.startsWith(`${p.id}-`));
  const hue = palette && HUES.find((h) => h.id === id.slice(palette.id.length + 1));
  if (!palette || !hue) return null;
  const shade = ([s, l]: number[]): Hsl => [hue.h, hue.gray ? s * 0.15 : s, l];
  return { light: shade(palette.light), dark: shade(palette.dark) };
}

/** The family of link and highlight colors that stands out on this note color. */
export function noteTone(id: string | null | undefined) {
  const h = noteShades(id)?.light[0];
  if (h === undefined) return undefined;
  return h < 60 || h > 300 ? 'warm' : h < 190 ? 'green' : 'cool';
}

/** A CSS color that follows the page's color-scheme, so a theme switch needs no re-render. */
export function noteBg(id: string | null | undefined) {
  const shades = noteShades(id);
  if (!shades) return undefined;
  const css = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l}%)`;
  return `light-dark(${css(shades.light)}, ${css(shades.dark)})`;
}
