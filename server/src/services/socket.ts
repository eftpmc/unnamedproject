import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../lib/jwt.js';

type UserId = string;

const clients = new Map<UserId, Set<WebSocket>>();
let wss: WebSocketServer;

export function initSocket(server: Server): void {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) { ws.close(1008, 'Missing token'); return; }

    let userId: string;
    try {
      userId = verifyToken(token).userId;
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);

    ws.on('close', () => {
      clients.get(userId)?.delete(ws);
      if (clients.get(userId)?.size === 0) clients.delete(userId);
    });
  });
}

export function broadcast(userId: string, event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  clients.get(userId)?.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}
