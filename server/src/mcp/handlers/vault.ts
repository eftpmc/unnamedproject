import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { encrypt, decrypt, deriveKey } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';

export function registerVaultHandlers(): void {
  registerTool({
    name: 'vault_set',
    description: 'Store a credential securely in the encrypted vault. Use descriptive keys like "handshake", "github_token", or "handshake_login". Value can be a password, token, or "username:password" pair.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Identifier for this credential (e.g. "handshake", "github_token")' },
        value: { type: 'string', description: 'The secret value to store' },
      },
      required: ['key', 'value'],
    },
    handler: async (args, userId) => {
      const key = String(args.key).trim().toLowerCase();
      const value = String(args.value);
      if (!key) throw new Error('key is required');
      const encrypted = encrypt(value, deriveKey());
      getDb()
        .prepare(`
          INSERT INTO vault_entries (id, user_id, key, encrypted_value)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = unixepoch()
        `)
        .run(newId(), userId, key, encrypted);
      return `Stored credential "${key}" in vault.`;
    },
  });

  registerTool({
    name: 'vault_get',
    description: 'Retrieve a credential from the encrypted vault by key. Returns the stored value (password, token, or "username:password").',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The credential key to retrieve' },
      },
      required: ['key'],
    },
    handler: async (args, userId) => {
      const key = String(args.key).trim().toLowerCase();
      const row = getDb()
        .prepare('SELECT encrypted_value FROM vault_entries WHERE user_id = ? AND key = ?')
        .get(userId, key) as { encrypted_value: string } | undefined;
      if (!row) return `No credential found for key "${key}". Use vault_list to see available keys.`;
      return decrypt(row.encrypted_value, deriveKey());
    },
  });

  registerTool({
    name: 'vault_list',
    description: 'List all credential keys stored in the vault. Values are never returned by this tool.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const rows = getDb()
        .prepare('SELECT key, updated_at FROM vault_entries WHERE user_id = ? ORDER BY key')
        .all(userId) as { key: string; updated_at: number }[];
      if (rows.length === 0) return 'Vault is empty.';
      return rows.map(r => `- ${r.key}`).join('\n');
    },
  });

  registerTool({
    name: 'vault_delete',
    description: 'Remove a credential from the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The credential key to delete' },
      },
      required: ['key'],
    },
    handler: async (args, userId) => {
      const key = String(args.key).trim().toLowerCase();
      const result = getDb()
        .prepare('DELETE FROM vault_entries WHERE user_id = ? AND key = ?')
        .run(userId, key);
      return result.changes > 0 ? `Deleted "${key}" from vault.` : `No credential found for key "${key}".`;
    },
  });
}
