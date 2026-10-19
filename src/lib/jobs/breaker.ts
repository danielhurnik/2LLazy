const FAILURES_BEFORE_PAUSE = 3;
const MS_PER_MINUTE = 60_000;
const PAUSE_MS = 10 * MS_PER_MINUTE;

interface BreakerState {
  consecutiveFailures: number;
  pausedUntil: number;
}

const breakerBySource = new Map<string, BreakerState>();

function breakerFor(sourceId: string): BreakerState {
  let state = breakerBySource.get(sourceId);
  if (!state) {
    state = { consecutiveFailures: 0, pausedUntil: 0 };
    breakerBySource.set(sourceId, state);
  }
  return state;
}

export function pausedForMinutes(sourceId: string): number {
  const remainingMs = breakerFor(sourceId).pausedUntil - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_MINUTE) : 0;
}

export function recordSuccess(sourceId: string): void {
  const state = breakerFor(sourceId);
  state.consecutiveFailures = 0;
  state.pausedUntil = 0;
}

export function recordFailure(sourceId: string): void {
  const state = breakerFor(sourceId);
  state.consecutiveFailures++;
  if (state.consecutiveFailures >= FAILURES_BEFORE_PAUSE) {
    state.pausedUntil = Date.now() + PAUSE_MS;
    state.consecutiveFailures = 0;
  }
}
