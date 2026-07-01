import { registerTool } from '../registry.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';
import {
  createOrUpdateToolPackage,
  disableToolPackage,
  installToolPackage,
  listToolPackages,
  testToolPackage,
  type ToolPackageFile,
} from '../../services/tool-packages.js';
import { createSessionEvent, getDb, getToolPackage } from '../../db/index.js';
import { broadcast } from '../../services/socket.js';

function approved(decision: unknown): boolean {
  return decision === 'approved'
    || (typeof decision === 'object' && decision !== null && (decision as { decision?: string }).decision === 'approved');
}

function emitToolPackageEvent(
  userId: string,
  sessionId: string | null,
  type: 'installed' | 'disabled',
  pkg: { id: string; name: string; description?: string; connection_id?: string | null },
  executionId: string,
): void {
  if (!sessionId) return;
  const event = createSessionEvent({
    sessionId,
    type: type === 'installed' ? 'connection_created' : 'runtime_checkpoint',
    title: type === 'installed' ? `Installed tool package: ${pkg.name}` : `Disabled tool package: ${pkg.name}`,
    body: pkg.description || null,
    executionId,
    metadata: {
      kind: 'tool_package',
      packageId: pkg.id,
      connectionId: pkg.connection_id ?? null,
      action: type,
    },
  });
  broadcast(userId, {
    type: 'session_event_created',
    sessionId,
    event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
  });
}

function enableConnectionForSessionProject(userId: string, sessionId: string | null, connectionId: string | null): void {
  if (!sessionId || !connectionId) return;
  const row = getDb()
    .prepare(`
      SELECT p.id, p.enabled_connection_ids
      FROM sessions s
      JOIN projects p ON p.id = s.pinned_project_id AND p.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
    `)
    .get(sessionId, userId) as { id: string; enabled_connection_ids: string } | undefined;
  if (!row) return;
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(row.enabled_connection_ids || '[]') as unknown;
    ids = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    ids = [];
  }
  if (ids.includes(connectionId)) return;
  ids.push(connectionId);
  getDb()
    .prepare('UPDATE projects SET enabled_connection_ids = ? WHERE id = ?')
    .run(JSON.stringify(ids), row.id);
}

export function registerToolPackageHandlers(): void {
  registerTool({
    name: 'create_tool_package',
    description: 'Create or update an agent-built local MCP package in the managed tools directory. This writes package files only; call request_tool_install to activate it as an MCP connection after user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: {
          type: 'object',
          description: 'Package manifest: { name, description, runtime: "node"|"python", entry, scope, permissions }. The entry must be a relative file path.',
        },
        files: {
          type: 'array',
          description: 'Package source files. Paths must be relative and cannot include tool-package.json.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['manifest', 'files'],
    },
    handler: async (args, userId, sessionId) => {
      const pkg = await createOrUpdateToolPackage({
        userId,
        manifest: args.manifest,
        files: args.files as ToolPackageFile[],
        sourceSessionId: sessionId,
      });
      return JSON.stringify(pkg, null, 2);
    },
  });

  registerTool({
    name: 'test_tool_package',
    description: 'Validate an agent-built MCP package and run an MCP tools/list handshake without activating it.',
    inputSchema: {
      type: 'object',
      properties: { package_id: { type: 'string' } },
      required: ['package_id'],
    },
    handler: async (args, userId) => {
      return JSON.stringify(await testToolPackage(userId, args.package_id as string), null, 2);
    },
  });

  registerTool({
    name: 'request_tool_install',
    description: 'Request user approval to activate a generated tool package as an MCP connection. The platform derives the command from the package manifest and records the resulting connection.',
    inputSchema: {
      type: 'object',
      properties: {
        package_id: { type: 'string' },
        reason: { type: 'string', description: 'Short explanation shown to the user for why this MCP should be installed.' },
      },
      required: ['package_id', 'reason'],
    },
    handler: async (args, userId, sessionId) => {
      const packageId = args.package_id as string;
      const validation = await testToolPackage(userId, packageId);
      if (!validation.ok || !validation.package) return JSON.stringify(validation, null, 2);

      const executionId = createExecution(userId, null, null, 'request_tool_install');
      const decision = await requestApproval(executionId, userId, 'install_tool_package', {
        session_id: sessionId,
        package_id: packageId,
        reason: args.reason,
        ui: {
          kind: 'tool_package',
          name: validation.package.name,
          description: validation.package.description,
          runtime: validation.package.manifest.runtime,
          entry: validation.package.manifest.entry,
          permissions: validation.package.manifest.permissions,
          reason: args.reason,
        },
      }, 'user');
      if (!approved(decision)) {
        completeExecution(executionId, userId, 'error', 'User rejected tool package install.');
        return 'Cancelled: user did not approve tool package installation.';
      }

      try {
        const installed = await installToolPackage(userId, packageId);
        enableConnectionForSessionProject(userId, sessionId, installed.connection_id);
        emitToolPackageEvent(userId, sessionId, 'installed', installed, executionId);
        completeExecution(executionId, userId, 'done', JSON.stringify(installed));
        return JSON.stringify(installed, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeExecution(executionId, userId, 'error', message);
        return `Error: ${message}`;
      }
    },
  });

  registerTool({
    name: 'list_tool_packages',
    description: 'List agent-built MCP packages and their install status.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => JSON.stringify(listToolPackages(userId), null, 2),
  });

  registerTool({
    name: 'disable_tool_package',
    description: 'Disable an installed tool package and remove its generated MCP connection.',
    inputSchema: {
      type: 'object',
      properties: { package_id: { type: 'string' } },
      required: ['package_id'],
    },
    handler: async (args, userId, sessionId) => {
      const packageId = args.package_id as string;
      const pkg = getToolPackage(userId, packageId);
      if (!pkg) return `Error: tool package ${packageId} not found`;
      const executionId = createExecution(userId, null, null, 'disable_tool_package');
      const decision = await requestApproval(executionId, userId, 'disable_tool_package', {
        session_id: sessionId,
        package_id: packageId,
        ui: { kind: 'tool_package_disable', packageId, name: pkg.name },
      }, 'user');
      if (!approved(decision)) {
        completeExecution(executionId, userId, 'error', 'User rejected tool package disable.');
        return 'Cancelled: user did not approve disabling this tool package.';
      }
      try {
        const disabled = disableToolPackage(userId, packageId);
        emitToolPackageEvent(userId, sessionId, 'disabled', disabled, executionId);
        completeExecution(executionId, userId, 'done', JSON.stringify(disabled));
        return JSON.stringify(disabled, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeExecution(executionId, userId, 'error', message);
        return `Error: ${message}`;
      }
    },
  });
}
