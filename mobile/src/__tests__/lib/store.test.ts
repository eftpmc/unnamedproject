jest.mock('expo-secure-store');
jest.mock('../../lib/storage', () => ({
  setToken: jest.fn(),
  clearToken: jest.fn(),
  setServerUrl: jest.fn(),
  getSavedHosts: jest.fn().mockResolvedValue([]),
  addSavedHost: jest.fn(),
}));

import { useAppStore } from '../../lib/store';

beforeEach(() => useAppStore.setState({
  serverUrl: null, token: null,
  wsStatus: 'disconnected', pendingApprovalCount: 0,
}));

it('setToken updates state', async () => {
  await useAppStore.getState().setToken('abc');
  expect(useAppStore.getState().token).toBe('abc');
});

it('signOut clears token and resets counts', async () => {
  useAppStore.setState({ token: 'tok', pendingApprovalCount: 3 });
  await useAppStore.getState().signOut();
  expect(useAppStore.getState().token).toBeNull();
  expect(useAppStore.getState().pendingApprovalCount).toBe(0);
});

it('incrementPendingApprovals increments', () => {
  useAppStore.setState({ pendingApprovalCount: 1 });
  useAppStore.getState().incrementPendingApprovals();
  expect(useAppStore.getState().pendingApprovalCount).toBe(2);
});

it('decrementPendingApprovals does not go below 0', () => {
  useAppStore.setState({ pendingApprovalCount: 0 });
  useAppStore.getState().decrementPendingApprovals();
  expect(useAppStore.getState().pendingApprovalCount).toBe(0);
});
