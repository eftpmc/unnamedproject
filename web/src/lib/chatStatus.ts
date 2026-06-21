import type { getChatStatus } from './api.js';

export function getAgentStatusText({
  sending,
  agentStarting,
  chatStatus,
  now,
}: {
  sending: boolean;
  agentStarting: boolean;
  chatStatus: Awaited<ReturnType<typeof getChatStatus>> | undefined;
  now: number;
}): string {
  if (sending) return 'Sending message...';
  const elapsedFrom = chatStatus?.execution?.createdAt ?? chatStatus?.turn?.startedAt ?? null;
  const elapsed = elapsedFrom ? ` for ${formatElapsedSeconds(now - elapsedFrom)}` : '';
  if (chatStatus?.execution) {
    const tool = formatToolName(chatStatus.execution.tool);
    if (chatStatus.execution.status === 'awaiting_approval') return `${tool} is waiting for approval${elapsed}`;
    return `Running ${tool}${elapsed}`;
  }
  if (agentStarting) return `Agent is getting started${elapsed}`;
  return `Agent is working${elapsed}`;
}

export function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatToolName(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}
