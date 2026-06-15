import { AppState } from 'react-native';
import { useAppStore } from './store';
import type { WSEvent } from '../../types';

type Listener = (event: WSEvent) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionallyDisconnected = false;
const listeners = new Set<Listener>();
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

export function connect(): void {
  intentionallyDisconnected = false;
  const { serverUrl, token } = useAppStore.getState();
  if (!serverUrl || !token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  useAppStore.getState().setWsStatus('connecting');

  const wsUrl = `${serverUrl.replace(/^http/, 'ws')}?token=${token}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    useAppStore.getState().setWsStatus('connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onclose = () => {
    useAppStore.getState().setWsStatus('disconnected');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => ws?.close();

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      listeners.forEach(l => l(event));
    } catch { /* ignore malformed events */ }
  };
}

function scheduleReconnect(): void {
  if (intentionallyDisconnected || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

export function disconnect(): void {
  intentionallyDisconnected = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  ws?.close();
  ws = null;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call once after login to handle foreground reconnects */
export function startAppStateListener(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') connect();
  });
}

export function stopAppStateListener(): void {
  appStateSub?.remove();
  appStateSub = null;
}
