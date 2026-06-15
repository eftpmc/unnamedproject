import { create } from 'zustand';
import { setToken as persistToken, clearToken, setServerUrl as persistUrl, addSavedHost } from './storage';

export type WsStatus = 'connected' | 'connecting' | 'disconnected';

interface AppState {
  serverUrl: string | null;
  token: string | null;
  wsStatus: WsStatus;
  pendingApprovalCount: number;
  setServerUrl: (url: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: (serverUrl: string | null, token: string | null) => void;
  setWsStatus: (status: WsStatus) => void;
  setPendingApprovalCount: (n: number) => void;
  incrementPendingApprovals: () => void;
  decrementPendingApprovals: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  serverUrl: null,
  token: null,
  wsStatus: 'disconnected',
  pendingApprovalCount: 0,

  setServerUrl: async (url) => {
    await persistUrl(url);
    await addSavedHost(url);
    set({ serverUrl: url });
  },

  setToken: async (token) => {
    await persistToken(token);
    set({ token });
  },

  signOut: async () => {
    await clearToken();
    set({ token: null, pendingApprovalCount: 0, wsStatus: 'disconnected' });
  },

  hydrate: (serverUrl, token) => set({ serverUrl, token }),

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setPendingApprovalCount: (pendingApprovalCount) => set({ pendingApprovalCount }),

  incrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: s.pendingApprovalCount + 1 })),

  decrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: Math.max(0, s.pendingApprovalCount - 1) })),
}));
