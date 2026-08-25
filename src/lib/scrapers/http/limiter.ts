/**
 * Request pacing — the thing that keeps a scrape from being rate limited.
 *
 * Every job board is somebody's server. Hitting one with fifty parallel
 * requests gets the app a 429, then a block, and deservedly so. This module
 * enforces three rules for every outbound request:
 *
 *   1. a per-host token bucket, so no single board sees more than N requests
 *      per second regardless of how many boards are running;
 *   2. a per-host concurrency cap, so a slow board cannot pile up connections;
 *   3. a global concurrency cap, so the whole run stays within one machine's
 *      sensible limits.
 *
 * On top of that it handles the two responses that mean "slow down": a 429 or
 * 503 pauses the whole host for the `Retry-After` it asked for (or an
 * exponentially backing-off guess), and repeated failures widen the interval
 * for the rest of the run. Backoff is jittered so parallel workers do not
 * synchronise into a thundering herd.
 *
 * Nothing here is board-specific. A board that needs to be gentler declares it
 * once, via `configureHost`.
 */

export interface HostPolicy {
  /** Sustained request rate for this host. */
  requestsPerSecond: number;
  /** Requests in flight to this host at once. */
  concurrency: number;
  /** Extra pause after each request, on top of the rate limit. */
  minDelayMs: number;
}

/**
 * Deliberately conservative: one request per second with two in flight is
 * slower than these sites can serve, and that is the point — an ingest run has
 * no deadline, so there is nothing to gain by pushing.
 */
export const DEFAULT_POLICY: HostPolicy = {
  requestsPerSecond: 1.5,
  concurrency: 2,
  minDelayMs: 150,
};

/** Requests in flight across all hosts. */
let globalConcurrency = 8;

export function setGlobalConcurrency(value: number): void {
  globalConcurrency = Math.max(1, Math.floor(value));
}

const hostPolicies = new Map<string, HostPolicy>();

/** Overrides the pacing for one host, e.g. a board known to be touchy. */
export function configureHost(host: string, policy: Partial<HostPolicy>): void {
  hostPolicies.set(normaliseHost(host), { ...DEFAULT_POLICY, ...hostPolicies.get(normaliseHost(host)), ...policy });
}

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function policyFor(host: string): HostPolicy {
  return hostPolicies.get(normaliseHost(host)) ?? DEFAULT_POLICY;
}

interface HostState {
  /** Earliest time the next request to this host may start. */
  nextAvailableAt: number;
  inFlight: number;
  /** Consecutive throttling responses; widens the backoff. */
  strikes: number;
  /** Queue of waiters, released in arrival order. */
  waiters: Array<() => void>;
}

const hosts = new Map<string, HostState>();

function stateFor(host: string): HostState {
  const key = normaliseHost(host);
  let state = hosts.get(key);
  if (!state) {
    state = { nextAvailableAt: 0, inFlight: 0, strikes: 0, waiters: [] };
    hosts.set(key, state);
  }
  return state;
}

let inFlightTotal = 0;
const globalWaiters: Array<() => void> = [];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}

/** Random ±25% so parallel workers do not line up on the same tick. */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/**
 * Jitter that only ever waits longer.
 *
 * Used for an explicit `Retry-After`: the server named a time, and coming back
 * even slightly early is how a temporary throttle turns into a block. Spreading
 * upward keeps parallel workers from retrying in lockstep without ever
 * disobeying the instruction.
 */
function jitterUp(ms: number): number {
  return Math.round(ms * (1 + Math.random() * 0.25));
}

async function acquireGlobalSlot(signal?: AbortSignal): Promise<void> {
  while (inFlightTotal >= globalConcurrency) {
    await new Promise<void>((resolve) => globalWaiters.push(resolve));
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
  }
  inFlightTotal++;
}

function releaseGlobalSlot(): void {
  inFlightTotal--;
  globalWaiters.shift()?.();
}

async function acquireHostSlot(host: string, signal?: AbortSignal): Promise<void> {
  const state = stateFor(host);
  const policy = policyFor(host);

  while (state.inFlight >= policy.concurrency) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
  }
  state.inFlight++;

  // Token bucket, expressed as "the next request may not start before X".
  const spacing = 1000 / Math.max(policy.requestsPerSecond, 0.01);
  const now = Date.now();
  const startAt = Math.max(now, state.nextAvailableAt);
  state.nextAvailableAt = startAt + spacing + policy.minDelayMs;
  await sleep(startAt - now, signal);
}

function releaseHostSlot(host: string): void {
  const state = stateFor(host);
  state.inFlight--;
  state.waiters.shift()?.();
}

/**
 * Records that a host asked us to slow down, and returns how long to wait.
 *
 * `Retry-After` is honoured when the server sends one — it is the server
 * telling us exactly what it wants, and ignoring it is how a temporary 429
 * becomes a permanent block.
 */
export function penaliseHost(host: string, retryAfterHeader?: string | null): number {
  const state = stateFor(host);
  state.strikes++;

  const explicit = parseRetryAfter(retryAfterHeader);
  // 2s, 4s, 8s … capped at two minutes, when the server did not say.
  const waitMs =
    explicit !== null
      ? jitterUp(explicit)
      : jitter(Math.min(2000 * 2 ** (state.strikes - 1), 120_000));

  // Freeze the whole host, not just this request: the next one would be
  // throttled too, and queuing it up only deepens the hole.
  state.nextAvailableAt = Math.max(state.nextAvailableAt, Date.now() + waitMs);
  return waitMs;
}

/** A host that answered normally has earned its strikes back. */
export function rewardHost(host: string): void {
  const state = stateFor(host);
  if (state.strikes > 0) state.strikes--;
}

export function strikesFor(host: string): number {
  return stateFor(host).strikes;
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 300_000);

  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 300_000);

  return null;
}

/**
 * Runs `fn` under this host's rate limit and concurrency caps.
 * Slots are always released, including when `fn` throws.
 */
export async function withHostLimit<T>(
  url: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const host = hostOf(url);

  await acquireGlobalSlot(signal);
  try {
    await acquireHostSlot(host, signal);
    try {
      return await fn();
    } finally {
      releaseHostSlot(host);
    }
  } finally {
    releaseGlobalSlot();
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Test seam: forget all pacing state. */
export function resetLimiter(): void {
  hosts.clear();
  hostPolicies.clear();
  globalWaiters.length = 0;
  inFlightTotal = 0;
  globalConcurrency = 8;
}
