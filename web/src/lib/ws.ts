import { getToken } from './auth.js';
import type { WSEvent } from '../types.js';

type Subscriber = (event: WSEvent) => void;

let socket: WebSocket | null = null;
const subscribers = new Set<Subscriber>();
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev the page is served by Vite (e.g. :5177) but the WS server lives on
  // the Express port. Use VITE_API_PORT when set, fall back to 3000.
  const host = import.meta.env.DEV
    ? `localhost:${import.meta.env.VITE_API_PORT ?? 3000}`
    : window.location.host;
  return `${protocol}//${host}?token=${token}`;
}

export function connect(): void {
  const token = getToken();
  if (!token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  socket = new WebSocket(getWsUrl(token));

  socket.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      subscribers.forEach(fn => fn(event));
    } catch {
      // ignore malformed messages
    }
  };

  socket.onopen = () => {
    reconnectDelay = 1000;
    subscribers.forEach(fn => fn({ type: 'ws_connected' } as unknown as WSEvent));
  };

  socket.onclose = () => {
    socket = null;
    subscribers.forEach(fn => fn({ type: 'ws_disconnected' } as unknown as WSEvent));
    const t = getToken();
    if (t) {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }
  };

  socket.onerror = () => {
    socket?.close();
  };
}

export function disconnect(): void {
  socket?.close();
  socket = null;
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
