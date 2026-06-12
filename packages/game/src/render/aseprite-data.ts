/** Shared helpers for the Aseprite-JSON atlases `npm run export:art` emits. */

export interface AsepriteData {
  frames: Record<string, { duration: number }>;
  meta: { frameTags: { name: string; from: number; to: number }[] };
}

/** Frame names sorted by the frame index baked into the export's
 *  `{title} {frame}.{extension}` filename format. */
export function orderedFrameNames(data: AsepriteData): string[] {
  return Object.keys(data.frames)
    .map((name) => ({ name, index: Number(/(\d+)\.aseprite$/.exec(name)?.[1] ?? Number.NaN) }))
    .filter((e) => Number.isFinite(e.index))
    .sort((a, b) => a.index - b.index)
    .map((e) => e.name);
}
