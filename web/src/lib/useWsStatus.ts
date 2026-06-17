import { useEffect, useState } from 'react';
import { subscribe } from './ws.js';

export type WsStatus = 'connected' | 'disconnected';

export function useWsStatus(): WsStatus {
  // Start invisible — only show the banner after we've confirmed at least one
  // successful connection. This prevents spurious "Reconnecting" flashes during
  // the initial handshake or dev-server hot reloads.
  const [everConnected, setEverConnected] = useState(false);
  const [status, setStatus] = useState<WsStatus>('connected');

  useEffect(() => {
    return subscribe(event => {
      if (event.type === 'ws_connected') {
        setEverConnected(true);
        setStatus('connected');
      } else if (event.type === 'ws_disconnected') {
        setStatus('disconnected');
      }
    });
  }, []);

  return everConnected ? status : 'connected';
}
