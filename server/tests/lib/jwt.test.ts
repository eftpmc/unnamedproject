import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../../src/lib/jwt.js';

describe('jwt', () => {
  it('roundtrips a userId', () => {
    const token = signToken('user-123');
    const payload = verifyToken(token);
    expect(payload.userId).toBe('user-123');
  });

  it('throws on tampered token', () => {
    const token = signToken('user-123') + 'tampered';
    expect(() => verifyToken(token)).toThrow();
  });
});
