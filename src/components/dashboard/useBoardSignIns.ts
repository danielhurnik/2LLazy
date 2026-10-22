"use client";

import { useSyncExternalStore } from "react";
import { errorMessage, isRecord } from "@/lib/guards";
import { MS_PER_MINUTE, MS_PER_SECOND } from "@/lib/time";
import { describeRejection } from "./useAutoApply";

const SIGN_IN_ENDPOINT = "/api/apply/signin";
const SIGN_IN_POLL_MS = 3 * MS_PER_SECOND;
const SIGN_IN_MAX_WAIT_MS = 16 * MS_PER_MINUTE;

export interface BoardSignIn {
  host: string;
  loginUrl: string;
  signedIn: boolean;
  pending: boolean;
}

interface SignInState {
  boards: BoardSignIn[];
  pendingHosts: ReadonlySet<string>;
  error: string | null;
}

const EMPTY_STATE: SignInState = { boards: [], pendingHosts: new Set(), error: null };

let state = EMPTY_STATE;
const listeners = new Set<() => void>();

function update(changes: Partial<SignInState>): void {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

function toBoardSignIns(body: unknown): BoardSignIn[] {
  if (!isRecord(body) || !Array.isArray(body.hosts)) return [];
  return body.hosts.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.host === "string" && typeof entry.loginUrl === "string"
      ? [{ host: entry.host, loginUrl: entry.loginUrl, signedIn: entry.signedIn === true, pending: entry.pending === true }]
      : [],
  );
}

async function fetchBoardSignIns(): Promise<BoardSignIn[]> {
  const response = await fetch(SIGN_IN_ENDPOINT);
  return response.ok ? toBoardSignIns(await response.json()) : [];
}

async function refreshBoards(): Promise<void> {
  const boards = await fetchBoardSignIns().catch(() => null);
  if (boards) update({ boards });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilSignedIn(host: string): Promise<boolean> {
  const deadline = Date.now() + SIGN_IN_MAX_WAIT_MS;
  while (Date.now() < deadline && listeners.size > 0) {
    await pause(SIGN_IN_POLL_MS);
    await refreshBoards();
    const board = state.boards.find((candidate) => candidate.host === host);
    if (board?.signedIn) return true;
    if (board && !board.pending) return false;
  }
  return false;
}

function withPending(host: string, isPending: boolean): ReadonlySet<string> {
  const pendingHosts = new Set(state.pendingHosts);
  if (isPending) pendingHosts.add(host);
  else pendingHosts.delete(host);
  return pendingHosts;
}

async function signIn(host: string): Promise<void> {
  if (state.pendingHosts.has(host)) return;
  update({ pendingHosts: withPending(host, true), error: null });
  try {
    const response = await fetch(SIGN_IN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
    });
    if (!response.ok) throw new Error(await describeRejection(response, "Could not open the sign-in window"));
    const body: unknown = await response.json();
    const hasStarted = isRecord(body) && body.started === true;
    const signedIn = hasStarted ? await waitUntilSignedIn(host) : isRecord(body) && body.signedIn === true;
    update({ boards: state.boards.map((board) => (board.host === host ? { ...board, signedIn, pending: false } : board)) });
    if (!signedIn) update({ error: `Not signed in to ${host}. The window closed or the wait ran out; try again when ready.` });
  } catch (err) {
    update({ error: errorMessage(err) });
  } finally {
    update({ pendingHosts: withPending(host, false) });
  }
}

const refreshOnFocus = () => void refreshBoards();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshBoards();
    window.addEventListener("focus", refreshOnFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("focus", refreshOnFocus);
  };
}

export const hostOfUrl = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function useBoardSignIns() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY_STATE);
  return { ...snapshot, signIn };
}
