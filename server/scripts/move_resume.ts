import fs from 'fs/promises';
import { getDb, initDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';
import { ensureFilesRepo, commitFiles, resolveInFiles } from '../src/lib/spaceFs.js';

const OLD_FILE_ID = 'v7BNtqnUwypn3a7KlzMmj';
const NEW_SPACE = 'JjyWfBVEC25cb0TTgGWcN';

initDb();
const db = getDb();
const row = db.prepare('SELECT * FROM files WHERE id = ?').get(OLD_FILE_ID) as any;
if (!row) throw new Error('source file not found');

await ensureFilesRepo(NEW_SPACE);
await ensureFilesRepo(row.space_id);
const srcAbs = resolveInFiles(row.space_id, row.path);
const data = await fs.readFile(srcAbs);
const destAbs = resolveInFiles(NEW_SPACE, row.path);
await fs.writeFile(destAbs, data);

const now = Math.floor(Date.now() / 1000);
const newId_ = newId();
db.prepare(
  'INSERT INTO files (id,space_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(newId_, NEW_SPACE, row.path, row.title, row.type, row.status, row.mime_type, row.tags, row.source_session_id, now, now);
await commitFiles(NEW_SPACE, `add ${row.path}`);

// remove from old space
await fs.unlink(srcAbs).catch(() => {});
db.prepare('DELETE FROM files WHERE id = ?').run(OLD_FILE_ID);
await commitFiles(row.space_id, `delete ${row.path}`);

console.log('moved file, new id:', newId_);
