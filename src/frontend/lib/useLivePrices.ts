"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Live last prices from BingX's public perpetual-swap WebSocket, straight from the browser (no server
 * load, no API key). BingX sends gzip-compressed frames and a "Ping" text that must be answered "Pong".
 * One socket per page; it reconnects with a growing delay and is closed when nothing needs prices.
 * Prices are flushed to React at most twice a second.
 */
const URL = "wss://open-api-swap.bingx.com/swap-market";
const FLUSH_MS = 500;

async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export function useLivePrices(symbols: string[]): Record<string, number> {
  const key = useMemo(() => [...new Set(symbols)].sort().join(","), [symbols]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0 || typeof WebSocket === "undefined" || typeof DecompressionStream === "undefined") return;

    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const pending: Record<string, number> = {};
    let dirty = false;
    const flush = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setPrices((old) => ({ ...old, ...pending }));
    }, FLUSH_MS);

    const connect = () => {
      ws = new WebSocket(URL);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        retry = 0;
        for (const s of list) ws?.send(JSON.stringify({ id: s, reqType: "sub", dataType: `${s}@lastPrice` }));
      };
      ws.onmessage = async (e) => {
        try {
          const text = typeof e.data === "string" ? e.data : await gunzip(e.data as ArrayBuffer);
          if (text === "Ping") return ws?.send("Pong");
          const msg = JSON.parse(text) as { dataType?: string; data?: { s?: string; c?: string } | null };
          const symbol = msg.data?.s;
          const price = Number(msg.data?.c);
          if (symbol && price > 0) {
            pending[symbol] = price;
            dirty = true;
          }
        } catch {
          // A frame we cannot read is skipped; the next one carries a fresh price.
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      stopped = true;
      clearInterval(flush);
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [key]);

  return prices;
}
