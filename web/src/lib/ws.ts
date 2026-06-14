import { getToken } from './auth.js';
import type { WSEvent } from '../types.js';

type Subscriber = (event: WSEvent) => void;

let socket: WebSocket | null = null;
const subscribers = new Set<Subscriber>();
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
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
