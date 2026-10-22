"use client";

import { useEffect, useState } from "react";
import { errorMessage, isRecord } from "@/lib/guards";
import { describeRejection } from "./useAutoApply";

const SIGN_IN_ENDPOINT = "/api/apply/signin";

export interface BoardSignIn {
  host: string;
  loginUrl: string;
  signedIn: boolean;
}

function toBoardSignIns(body: unknown): BoardSignIn[] {
  if (!isRecord(body) || !Array.isArray(body.hosts)) return [];
  return body.hosts.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.host === "string" && typeof entry.loginUrl === "string"
      ? [{ host: entry.host, loginUrl: entry.loginUrl, signedIn: entry.signedIn === true }]
      : [],
  );
}

export const hostOfUrl = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function useBoardSignIns() {
  const [boards, setBoards] = useState<BoardSignIn[]>([]);
  const [pendingHost, setPendingHost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    fetch(SIGN_IN_ENDPOINT)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (isCurrent) setBoards(toBoardSignIns(body));
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, []);

  const signIn = async (host: string) => {
    setPendingHost(host);
    setError(null);
    try {
      const response = await fetch(SIGN_IN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host }),
      });
      if (!response.ok) throw new Error(await describeRejection(response, "Could not open the sign-in window"));
      const body: unknown = await response.json();
      const signedIn = isRecord(body) && body.signedIn === true;
      setBoards((current) => current.map((board) => (board.host === host ? { ...board, signedIn } : board)));
      if (!signedIn) setError(`Not signed in to ${host}. The window closed or the wait ran out; try again when ready.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPendingHost(null);
    }
  };

  return { boards, pendingHost, error, signIn };
}
