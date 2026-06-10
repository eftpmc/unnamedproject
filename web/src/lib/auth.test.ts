import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, setToken, clearToken } from './auth';

beforeEach(() => localStorage.clear());

describe('auth', () => {
  it('returns null when no token', () => {
    expect(getToken()).toBeNull();
  });

  it('stores and retrieves token', () => {
    setToken('test-jwt');
    expect(getToken()).toBe('test-jwt');
  });

  it('clears token', () => {
    setToken('test-jwt');
    clearToken();
    expect(getToken()).toBeNull();
  });
});
