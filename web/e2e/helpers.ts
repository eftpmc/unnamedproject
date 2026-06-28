import { APIRequestContext } from '@playwright/test';

// Pre-generated JWT for playwright-test-user (expires 2027)
export const PLAYWRIGHT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJwbGF5d3JpZ2h0LXRlc3QtdXNlciIsImlhdCI6MTc4MjY3NTY0MywiZXhwIjoxODE0MjExNjQzfQ.oK7qZfwIPPWU1oE_nFqikaTHnMB3e2K8YNERgZkvaCA';

const AUTH = { Authorization: `Bearer ${PLAYWRIGHT_TOKEN}` };
const BASE = 'http://localhost:3000';

export async function createChat(request: APIRequestContext, title = 'Playwright test chat'): Promise<string> {
  const res = await request.post(`${BASE}/sessions`, {
    headers: AUTH,
    data: { title },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function deleteChat(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${BASE}/sessions/${id}`, { headers: AUTH });
}

export async function createSpace(request: APIRequestContext, name = 'Playwright test space'): Promise<string> {
  const res = await request.post(`${BASE}/spaces`, {
    headers: AUTH,
    data: { name },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function deleteSpace(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${BASE}/spaces/${id}`, { headers: AUTH });
}

export async function createDocument(request: APIRequestContext, spaceId: string, title = 'Playwright test doc'): Promise<string> {
  const res = await request.post(`${BASE}/spaces/${spaceId}/documents`, {
    headers: AUTH,
    data: { path: 'playwright-test.md', title, body: '# Test' },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function createProject(request: APIRequestContext, name = 'Playwright test project'): Promise<string> {
  const res = await request.post(`${BASE}/projects`, {
    headers: AUTH,
    data: { name },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function deleteProject(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${BASE}/projects/${id}`, { headers: AUTH });
}

export async function createTrigger(request: APIRequestContext, projectId: string, kind: 'schedule' | 'webhook' | 'manual' = 'manual'): Promise<string> {
  const res = await request.post(`${BASE}/triggers`, {
    headers: AUTH,
    data: { kind, project_id: projectId },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function deleteTrigger(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${BASE}/triggers/${id}`, { headers: AUTH });
}
