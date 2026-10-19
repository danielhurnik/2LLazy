"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface StatusMessage {
  type: "success" | "error";
  text: string;
}

export function useTimedMessage(visibleMs: number) {
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const showMessage = useCallback(
    (type: StatusMessage["type"], text: string) => {
      cancelHideTimer();
      setMessage({ type, text });
      hideTimer.current = setTimeout(() => setMessage(null), visibleMs);
    },
    [cancelHideTimer, visibleMs],
  );

  const clearMessage = useCallback(() => {
    cancelHideTimer();
    setMessage(null);
  }, [cancelHideTimer]);

  useEffect(() => cancelHideTimer, [cancelHideTimer]);

  return { message, showMessage, clearMessage };
}
