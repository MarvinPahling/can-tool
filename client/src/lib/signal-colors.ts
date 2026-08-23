/** Assigns each signal a visually distinct color via golden-angle hue rotation. */
export function getSignalColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `oklch(0.75 0.15 ${hue})`;
}
