export function reorderItems<T extends { id: string }>(
  items: T[],
  keys: ReadonlySet<string | number>,
  target: string | number,
  position: "before" | "after",
) {
  if (keys.has(target)) return items;
  const moving = items.filter((item) => keys.has(item.id));
  const remaining = items.filter((item) => !keys.has(item.id));
  const index = remaining.findIndex((item) => item.id === target);
  if (index < 0 || !moving.length) return items;
  const insert = index + (position === "after" ? 1 : 0);
  return [...remaining.slice(0, insert), ...moving, ...remaining.slice(insert)];
}
