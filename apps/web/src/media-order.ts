export function reorderMedia<T extends { id: string }>(
  images: T[],
  keys: ReadonlySet<string | number>,
  target: string | number,
  position: "before" | "after",
) {
  if (keys.has(target)) return images;
  const moving = images.filter((image) => keys.has(image.id));
  const remaining = images.filter((image) => !keys.has(image.id));
  const index = remaining.findIndex((image) => image.id === target);
  if (index < 0 || !moving.length) return images;
  const insert = index + (position === "after" ? 1 : 0);
  return [...remaining.slice(0, insert), ...moving, ...remaining.slice(insert)];
}
