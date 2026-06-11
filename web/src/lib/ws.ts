import { getToken } from './auth.js';
import type { WSEvent } from '../types.js';

type Subscriber = (event: WSEvent) => void;

let socket: WebSocket | null = null;
const subscribers = new Set<Subscriber>();

export function connect(): void {
  const token = getToken();
  if (!token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const wsUrl = `ws://${window.location.hostname}:3000?token=${token}`;
  socket = new WebSocket(wsUrl);

  socket.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      subscribers.forEach(fn => fn(event));
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    socket = null;
    const t = getToken();
    if (t) setTimeout(connect, 3000);
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
