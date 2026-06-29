import { WebSocket } from 'ws';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ChromeClient {
  ws: WebSocket;
  pending: Map<string, PendingRequest>;
}

const clients = new Map<string, ChromeClient>();
let nextId = 1;

export function registerChromeBridgeSocket(userId: string, ws: WebSocket): void {
  const existing = clients.get(userId);
  if (existing?.ws.readyState === WebSocket.OPEN) {
    existing.ws.close(1000, 'Replaced by a newer Chrome bridge connection');
  }

  const client: ChromeClient = { ws, pending: new Map() };
  clients.set(userId, client);

  ws.on('message', data => {
    let msg: { id?: string; ok?: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(String(data)) as typeof msg;
    } catch {
      return;
    }
    if (!msg.id) return;
    const pending = client.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    client.pending.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error || 'Chrome bridge request failed'));
    }
  });

  ws.on('close', () => {
    if (clients.get(userId) === client) clients.delete(userId);
    for (const pending of client.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Chrome bridge disconnected'));
    }
    client.pending.clear();
  });
}

export function isChromeBridgeConnected(userId: string): boolean {
  return clients.get(userId)?.ws.readyState === WebSocket.OPEN;
}

export async function callChromeBridge(
  userId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const client = clients.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    throw new Error('Chrome extension is not connected. Open Chrome with the Unnamed extension installed and connected.');
  }

  const id = String(nextId++);
  const payload = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`Chrome bridge request timed out: ${method}`));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    client.ws.send(payload, err => {
      if (!err) return;
      clearTimeout(timer);
      client.pending.delete(id);
      reject(err);
    });
  });
}
