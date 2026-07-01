import fs from 'fs/promises';
import path from 'path';
import { getDb, getToolsDir, getToolPackage, getToolPackageByName, listToolPackages as listDbToolPackages, type DbToolPackage } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { closeMcpConnection, listMcpTools, type McpToolInfo } from '../lib/mcp-pool.js';
import { createConnectionRecord, ConnectionValidationError } from '../routes/connections.js';

const VALID_RUNTIME = new Set(['node', 'python']);
const VALID_SCOPE = new Set(['session', 'project', 'user']);
const VALID_FILESYSTEM_PERMISSIONS = new Set(['none', 'session', 'project_files', 'repo_read', 'repo_write', 'tools_dir']);
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const SUBPROCESS_NAME_RE = /^[a-zA-Z0-9._+-]{1,64}$/;

export interface ToolPackageManifest {
  name: string;
  description?: string;
  runtime: 'node' | 'python';
  entry: string;
  scope?: 'session' | 'project' | 'user';
  permissions?: {
    filesystem?: string[];
    network?: boolean;
    secrets?: string[];
    subprocess?: string[];
  };
}

export interface ToolPackageFile {
  path: string;
  content: string;
}

export interface ToolPackageView {
  id: string;
  name: string;
  description: string;
  status: string;
  package_path: string;
  manifest: ToolPackageManifest;
  connection_id: string | null;
  source_session_id: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  installed_at: number | null;
}

export interface ToolPackageValidationResult {
  ok: boolean;
  errors: string[];
  package: ToolPackageView | null;
}

export interface ToolPackageTestResult extends ToolPackageValidationResult {
  tools: McpToolInfo[];
}

function slugifyName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || slug.length > 64) throw new Error('Tool package name must be 1-64 URL-safe characters.');
  return slug;
}

function assertRelativeFilePath(filePath: string): string {
  if (!filePath || path.isAbsolute(filePath)) throw new Error('File paths must be relative.');
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new Error(`File path escapes the package directory: ${filePath}`);
  }
  if (normalized === '.' || normalized.endsWith('/')) throw new Error(`File path must name a file: ${filePath}`);
  return normalized;
}

function normalizeStringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`manifest.permissions.${label} must be an array.`);
  const out = value.map(item => String(item).trim()).filter(Boolean);
  if (out.length !== new Set(out).size) throw new Error(`manifest.permissions.${label} contains duplicate values.`);
  if (out.length > 32) throw new Error(`manifest.permissions.${label} may contain at most 32 values.`);
  return out;
}

function normalizePermissions(input: unknown): Required<NonNullable<ToolPackageManifest['permissions']>> {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const filesystem = normalizeStringList(raw.filesystem, 'filesystem');
  for (const permission of filesystem) {
    if (!VALID_FILESYSTEM_PERMISSIONS.has(permission)) {
      throw new Error(`Unsupported filesystem permission "${permission}". Allowed: ${Array.from(VALID_FILESYSTEM_PERMISSIONS).join(', ')}.`);
    }
  }
  if (filesystem.includes('none') && filesystem.length > 1) {
    throw new Error('filesystem permission "none" cannot be combined with other filesystem permissions.');
  }

  const secrets = normalizeStringList(raw.secrets, 'secrets');
  for (const secret of secrets) {
    if (!SECRET_NAME_RE.test(secret)) throw new Error(`Secret permission "${secret}" must be an uppercase environment variable name.`);
  }

  const subprocess = normalizeStringList(raw.subprocess, 'subprocess');
  for (const command of subprocess) {
    if (!SUBPROCESS_NAME_RE.test(command) || command.includes('/')) {
      throw new Error(`Subprocess permission "${command}" must be a command name, not a path or shell expression.`);
    }
  }

  return {
    filesystem: filesystem.filter(p => p !== 'none'),
    network: raw.network === true,
    secrets,
    subprocess,
  };
}

function normalizeManifest(input: unknown, fallbackName?: string): ToolPackageManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest is required');
  const raw = input as Record<string, unknown>;
  const name = slugifyName(String(raw.name ?? fallbackName ?? ''));
  const runtime = String(raw.runtime ?? '');
  if (!VALID_RUNTIME.has(runtime)) throw new Error('manifest.runtime must be "node" or "python".');
  const entry = assertRelativeFilePath(String(raw.entry ?? ''));
  const scope = raw.scope === undefined ? 'project' : String(raw.scope);
  if (!VALID_SCOPE.has(scope)) throw new Error('manifest.scope must be "session", "project", or "user".');
  const permissions = normalizePermissions(raw.permissions);
  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    runtime: runtime as ToolPackageManifest['runtime'],
    entry,
    scope: scope as ToolPackageManifest['scope'],
    permissions,
  };
}

function toView(row: DbToolPackage): ToolPackageView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    package_path: row.package_path,
    manifest: JSON.parse(row.manifest) as ToolPackageManifest,
    connection_id: row.connection_id,
    source_session_id: row.source_session_id,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    installed_at: row.installed_at,
  };
}

function userToolsRoot(userId: string): string {
  return path.join(getToolsDir(), userId);
}

function packagePathFor(userId: string, name: string): string {
  return path.join(userToolsRoot(userId), name);
}

async function writePackageFiles(packagePath: string, manifest: ToolPackageManifest, files: ToolPackageFile[]): Promise<void> {
  await fs.mkdir(packagePath, { recursive: true });
  const manifestPath = path.join(packagePath, 'tool-package.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const seen = new Set<string>();
  for (const file of files) {
    const rel = assertRelativeFilePath(file.path);
    if (rel === 'tool-package.json') throw new Error('tool-package.json is generated from manifest; do not include it in files.');
    if (seen.has(rel)) throw new Error(`Duplicate file path: ${rel}`);
    seen.add(rel);
    const dest = path.resolve(packagePath, rel);
    if (!dest.startsWith(path.resolve(packagePath) + path.sep)) {
      throw new Error(`File path escapes the package directory: ${file.path}`);
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.content);
  }
}

export async function createOrUpdateToolPackage(input: {
  userId: string;
  manifest: unknown;
  files: ToolPackageFile[];
  sourceSessionId?: string | null;
}): Promise<ToolPackageView> {
  const manifest = normalizeManifest(input.manifest);
  if (!Array.isArray(input.files) || input.files.length === 0) throw new Error('At least one package file is required.');
  const packagePath = packagePathFor(input.userId, manifest.name);
  await writePackageFiles(packagePath, manifest, input.files);

  const existing = getToolPackageByName(input.userId, manifest.name);
  const id = existing?.id ?? newId();
  if (existing) {
    if (existing.connection_id) {
      closeMcpConnection(existing.connection_id);
      getDb().prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(existing.connection_id, input.userId);
    }
    getDb()
      .prepare(`
        UPDATE tool_packages
        SET description = ?, package_path = ?, manifest = ?, status = 'draft', connection_id = NULL,
            source_session_id = ?, last_error = NULL, updated_at = unixepoch()
        WHERE id = ? AND user_id = ?
      `)
      .run(manifest.description ?? '', packagePath, JSON.stringify(manifest), input.sourceSessionId ?? null, id, input.userId);
  } else {
    getDb()
      .prepare(`
        INSERT INTO tool_packages (id, user_id, name, description, package_path, manifest, source_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.userId, manifest.name, manifest.description ?? '', packagePath, JSON.stringify(manifest), input.sourceSessionId ?? null);
  }
  return toView(getToolPackage(input.userId, id)!);
}

export async function validateToolPackage(userId: string, packageId: string): Promise<ToolPackageValidationResult> {
  const row = getToolPackage(userId, packageId);
  if (!row) return { ok: false, errors: [`Tool package ${packageId} not found`], package: null };
  const errors: string[] = [];
  let manifest: ToolPackageManifest | null = null;
  try { manifest = normalizeManifest(JSON.parse(row.manifest), row.name); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  if (manifest) {
    const entryPath = path.resolve(row.package_path, manifest.entry);
    const root = path.resolve(row.package_path);
    if (!entryPath.startsWith(root + path.sep)) errors.push('Manifest entry escapes the package directory.');
    try {
      const stat = await fs.stat(entryPath);
      if (!stat.isFile()) errors.push('Manifest entry is not a file.');
    } catch {
      errors.push(`Manifest entry does not exist: ${manifest.entry}`);
    }
  }
  if (errors.length) {
    getDb().prepare("UPDATE tool_packages SET status = 'error', last_error = ?, updated_at = unixepoch() WHERE id = ?").run(errors.join('\n'), packageId);
  }
  return { ok: errors.length === 0, errors, package: toView(getToolPackage(userId, packageId)!) };
}

function connectionConfigFor(pkg: ToolPackageView): { command: string; args: string; env: string; cwd: string } {
  const entry = path.join(pkg.package_path, pkg.manifest.entry);
  const env = {
    UNNAMED_TOOL_PACKAGE_ID: pkg.id,
    UNNAMED_TOOL_PACKAGE_NAME: pkg.name,
    UNNAMED_TOOL_PACKAGE_SCOPE: pkg.manifest.scope ?? 'project',
    UNNAMED_TOOL_PACKAGE_MANIFEST: path.join(pkg.package_path, 'tool-package.json'),
    UNNAMED_TOOL_NETWORK_ALLOWED: pkg.manifest.permissions?.network ? '1' : '0',
    UNNAMED_TOOL_FILESYSTEM: JSON.stringify(pkg.manifest.permissions?.filesystem ?? []),
    UNNAMED_TOOL_SECRETS: JSON.stringify(pkg.manifest.permissions?.secrets ?? []),
    UNNAMED_TOOL_SUBPROCESS: JSON.stringify(pkg.manifest.permissions?.subprocess ?? []),
  };
  if (pkg.manifest.runtime === 'node') return { command: 'node', args: JSON.stringify([entry]), env: JSON.stringify(env), cwd: pkg.package_path };
  return { command: 'python3', args: JSON.stringify([entry]), env: JSON.stringify(env), cwd: pkg.package_path };
}

export async function testToolPackage(userId: string, packageId: string): Promise<ToolPackageTestResult> {
  const validation = await validateToolPackage(userId, packageId);
  if (!validation.ok || !validation.package) return { ...validation, tools: [] };

  const cfg = connectionConfigFor(validation.package);
  const testConnectionId = `tool-package-test:${validation.package.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    const tools = await listMcpTools(
      testConnectionId,
      cfg.command,
      JSON.parse(cfg.args) as string[],
      JSON.parse(cfg.env) as Record<string, string>,
      cfg.cwd,
    );
    return { ...validation, ok: true, errors: [], tools };
  } catch (err) {
    const message = `MCP test failed: ${err instanceof Error ? err.message : String(err)}`;
    getDb()
      .prepare("UPDATE tool_packages SET status = 'error', last_error = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?")
      .run(message, packageId, userId);
    return {
      ok: false,
      errors: [message],
      package: toView(getToolPackage(userId, packageId)!),
      tools: [],
    };
  } finally {
    closeMcpConnection(testConnectionId);
  }
}

export async function installToolPackage(userId: string, packageId: string): Promise<ToolPackageView> {
  const validation = await validateToolPackage(userId, packageId);
  if (!validation.ok || !validation.package) throw new Error(validation.errors.join('\n'));
  const pkg = validation.package;
  if (pkg.status === 'installed' && pkg.connection_id) return pkg;

  try {
    const conn = createConnectionRecord(userId, {
      name: `tool:${pkg.name}`,
      type: 'mcp',
      purpose: 'mcp',
      config: connectionConfigFor(pkg),
      notes: `Agent-built MCP tool package: ${pkg.description || pkg.name}`,
      managedToolPackage: true,
    });
    getDb()
      .prepare(`
        UPDATE tool_packages
        SET status = 'installed', connection_id = ?, last_error = NULL, updated_at = unixepoch(), installed_at = unixepoch()
        WHERE id = ? AND user_id = ?
      `)
      .run(conn.id, packageId, userId);
  } catch (err) {
    const message = err instanceof ConnectionValidationError || err instanceof Error ? err.message : String(err);
    getDb()
      .prepare("UPDATE tool_packages SET status = 'error', last_error = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?")
      .run(message, packageId, userId);
    throw err;
  }
  return toView(getToolPackage(userId, packageId)!);
}

export function listToolPackages(userId: string): ToolPackageView[] {
  return listDbToolPackages(userId).map(toView);
}

export function disableToolPackage(userId: string, packageId: string): ToolPackageView {
  const row = getToolPackage(userId, packageId);
  if (!row) throw new Error(`Tool package ${packageId} not found`);
  if (row.connection_id) {
    closeMcpConnection(row.connection_id);
    getDb().prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(row.connection_id, userId);
  }
  getDb()
    .prepare(`
      UPDATE tool_packages
      SET status = 'disabled', connection_id = NULL, updated_at = unixepoch()
      WHERE id = ? AND user_id = ?
    `)
    .run(packageId, userId);
  return toView(getToolPackage(userId, packageId)!);
}
