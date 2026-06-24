import { requestApproval } from '../services/executor.js';
import { createConnectionRecord, ConnectionValidationError } from '../routes/connections.js';

const SECRET_KEY_PATTERN = /key|token|secret|password|credential/i;

function maskValue(value: string): string {
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}

/** Redacts secret-shaped fields so the raw credential never reaches the approval prompt, DB row, or session event log. */
function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && SECRET_KEY_PATTERN.test(key)) {
      masked[key] = maskValue(value);
    } else if (key === 'env' && value && typeof value === 'object') {
      masked[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? maskValue(v) : v]),
      );
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export async function createConnectionTool(
  input: { name: string; type: string; purpose?: string; config: Record<string, unknown> },
  ctx: { userId: string; executionId: string },
): Promise<string> {
  const decision = await requestApproval(
    ctx.executionId,
    ctx.userId,
    'create_connection',
    { name: input.name, type: input.type, purpose: input.purpose ?? 'tool', config: maskConfig(input.config) },
    'user',
  );
  if (decision === 'rejected') return 'create_connection cancelled';

  try {
    const { id, type, purpose } = createConnectionRecord(ctx.userId, input);
    return JSON.stringify({ id, name: input.name, type, purpose });
  } catch (err) {
    if (err instanceof ConnectionValidationError) return `Error: ${err.message}`;
    throw err;
  }
}
