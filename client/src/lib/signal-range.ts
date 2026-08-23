import type { DbcSignal } from "@/api/dbc";

/**
 * The physical value range a signal can actually encode, derived purely from
 * its bit width/signedness/factor/offset — not the DBC's declared min/max.
 * Reverse-engineered DBC files (e.g. opendbc-style) very commonly leave
 * min/max as an unreliable placeholder like `0|1` regardless of bit width,
 * so trusting them would reject values that are perfectly encodable.
 */
export function getSignalRange(signal: DbcSignal): { min: number; max: number } {
  if (signal.signed) {
    const rawMin = -(2 ** (signal.size - 1));
    const rawMax = 2 ** (signal.size - 1) - 1;
    return {
      min: rawMin * signal.factor + signal.offset,
      max: rawMax * signal.factor + signal.offset,
    };
  }
  const rawMax = 2 ** signal.size - 1;
  return { min: signal.offset, max: rawMax * signal.factor + signal.offset };
}
