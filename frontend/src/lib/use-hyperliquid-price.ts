"use client";

import { useEffect, useState } from "react";

export type PricePoint = { timestamp: string; priceUsdc: number };
type LivePrice = {
  source: "Hyperliquid";
  sourceUrl: string;
  wethUsdc: number;
  assets: { WETH: { publishedAt: string } };
};

export function parseEthTrades(data: unknown, now = Date.now()): PricePoint[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((trade) => {
    const price = Number(trade?.px);
    const timestamp = Number(trade?.time);
    if (trade?.coin !== "ETH" || !Number.isFinite(price) || price <= 0
      || !Number.isFinite(timestamp) || timestamp > now + 5000 || timestamp < now - 90_000) return [];
    return [{ timestamp: new Date(timestamp).toISOString(), priceUsdc: price }];
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function useHyperliquidPrice() {
  const [feed, setFeed] = useState<{ points: PricePoint[]; livePrices: LivePrice | null; liveError: boolean }>({
    points: [], livePrices: null, liveError: false,
  });

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let latest: PricePoint | undefined;
    let lastTradeAt = 0;
    let lastMessageAt = Date.now();
    let dirty = false;
    let refreshing = false;
    const controller = new AbortController();
    const samples = new Map<number, PricePoint>();

    const merge = (points: PricePoint[], historical = false) => {
      for (const point of points) {
        const timestamp = Date.parse(point.timestamp);
        if (!Number.isFinite(timestamp) || !Number.isFinite(point.priceUsdc) || point.priceUsdc <= 0) continue;
        // One actual observation per second keeps the stream bounded. History
        // fills gaps but must never replace more recent streamed trades.
        const bucket = Math.floor(timestamp / 1000);
        const previous = samples.get(bucket);
        if ((!historical || !previous) && (!previous || point.timestamp >= previous.timestamp)) samples.set(bucket, point);
        if (!latest || point.timestamp > latest.timestamp
          || (!historical && point.timestamp === latest.timestamp)) latest = point;
      }
      for (const bucket of samples.keys()) if (bucket < (Date.now() - 65 * 60_000) / 1000) samples.delete(bucket);
      dirty = true;
    };
    const read = async (path: string) => {
      const response = await fetch(`/api/workspace/${path}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Hyperliquid unavailable");
      return response.json();
    };
    const history = async () => {
      try {
        const value = await read("live-price-history") as { source: string; points: PricePoint[] };
        if (!stopped && value.source === "Hyperliquid") merge(value.points, true);
      } catch { /* Keep streamed prices when the history request fails. */ }
    };
    const refresh = async () => {
      if (refreshing || Date.now() - lastTradeAt < 10_000) return;
      refreshing = true;
      try {
        const value = await read("live-prices") as LivePrice;
        if (!stopped && value.source === "Hyperliquid") merge([{
          timestamp: value.assets.WETH.publishedAt, priceUsdc: value.wethUsdc,
        }]);
      } catch { /* The age check below marks an unavailable feed as stale. */ }
      finally { refreshing = false; }
    };
    const connect = () => {
      if (stopped) return;
      lastMessageAt = Date.now();
      socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
      socket.onopen = () => {
        lastMessageAt = Date.now();
        socket?.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: "ETH" } }));
        void history();
      };
      socket.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const message = JSON.parse(event.data);
          if (message.channel !== "trades") return;
          const points = parseEthTrades(message.data);
          if (!points.length) return;
          attempt = 0;
          lastTradeAt = Date.now();
          merge(points);
        } catch { /* Ignore malformed messages without interrupting the feed. */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!stopped) reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15_000));
      };
    };
    connect();
    void refresh();
    // Coalesce busy trade batches while keeping the displayed price responsive.
    const paint = setInterval(() => {
      const stale = !latest || Date.now() - Date.parse(latest.timestamp) > 30_000;
      if (dirty) {
        dirty = false;
        setFeed({ points: [...samples.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
          livePrices: latest ? { source: "Hyperliquid", sourceUrl: "https://app.hyperliquid.xyz/trade/ETH",
            wethUsdc: latest.priceUsdc, assets: { WETH: { publishedAt: latest.timestamp } } } : null,
          liveError: stale });
      } else setFeed((previous) => previous.liveError === stale ? previous : { ...previous, liveError: stale });
    }, 250);
    const fallback = setInterval(() => void refresh(), 5000);
    const backfill = setInterval(() => void history(), 60_000);
    const heartbeat = setInterval(() => {
      if (!socket) return;
      if (Date.now() - lastMessageAt > 45_000) socket.close();
      else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
    }, 15_000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(reconnect);
      [paint, fallback, backfill, heartbeat].forEach(clearInterval);
      socket?.close();
    };
  }, []);

  return feed;
}
