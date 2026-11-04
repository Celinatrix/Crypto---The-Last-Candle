"use client";

import { useEffect, useState } from "react";
import { devClockOffset } from "./devClock";
import { DEV_MOCKS } from "./env";

// Dev mocks shift the clock so each scenario lands on the cycle day it demonstrates.
const read = () => Date.now() + (process.env.NODE_ENV === "development" && DEV_MOCKS ? devClockOffset() : 0);

/** Current time, refreshed on an interval so relative labels ("5 phút trước") stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setNow(read()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
