import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { asyncHandler, notFoundHandler, errorHandler } from '../../src/middleware/error-handler.js';

// errorHandler logs every failure; keep that out of the test output.
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

function mockRes() {
  const res = {} as Response & { body?: unknown; code?: number };
  res.status = vi.fn((c: number) => { res.code = c; return res; }) as unknown as Response['status'];
  res.json = vi.fn((b: unknown) => { res.body = b; return res; }) as unknown as Response['json'];
  res.headersSent = false;
  return res;
}
const req = { method: 'GET', path: '/x' } as Request;

describe('asyncHandler', () => {
  it('forwards a rejected promise to next', async () => {
    const next = vi.fn();
    const boom = new Error('boom');
    await asyncHandler(async () => { throw boom; })(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('does not call next on success', async () => {
    const next = vi.fn();
    await asyncHandler(async (_q, res) => { res.json({ ok: true }); })(req, mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('notFoundHandler', () => {
  it('responds 404', () => {
    const res = mockRes();
    notFoundHandler(req, res);
    expect(res.code).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('errorHandler', () => {
  const ORIG = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIG; });

  it('uses an error status when provided and exposes 4xx messages', () => {
    const res = mockRes();
    errorHandler(Object.assign(new Error('bad input'), { status: 400 }), req, res, vi.fn());
    expect(res.code).toBe(400);
    expect(res.body).toEqual({ error: 'bad input' });
  });

  it('defaults to 500 and hides the message in production', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    errorHandler(new Error('internal detail'), req, res, vi.fn());
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('exposes 500 messages outside production', () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    errorHandler(new Error('internal detail'), req, res, vi.fn());
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: 'internal detail' });
  });

  it('does not write a response if headers were already sent', () => {
    const res = mockRes();
    res.headersSent = true;
    errorHandler(new Error('late'), req, res, vi.fn());
    expect(res.status).not.toHaveBeenCalled();
  });
});
