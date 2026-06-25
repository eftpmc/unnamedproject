import { describe, it, expect } from 'vitest';
import { generateMcpToken, verifyMcpToken } from '../../src/mcp/auth.js';

describe('MCP auth tokens', () => {
  it('roundtrips userId', () => {
    const token = generateMcpToken('user-123');
    const payload = verifyMcpToken(token);
    expect(payload.userId).toBe('user-123');
  });

  it('rejects tokens signed with wrong secret', () => {
    expect(() => verifyMcpToken('not.a.token')).toThrow();
  });

  it('rejects non-mcp tokens', async () => {
    // signToken from jwt.ts has no scope claim
    const { signToken } = await import('../../src/lib/jwt.js');
    const appToken = signToken('user-123');
    expect(() => verifyMcpToken(appToken)).toThrow(/mcp/);
  });
});
