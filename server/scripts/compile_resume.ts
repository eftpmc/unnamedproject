import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { initDb, getDb } from '../src/db/index.js';
import { writeFile, writeBinaryFile } from '../src/services/files.js';

const execFileAsync = promisify(execFile);

initDb();

const PROJECT_ID = 'Bu85Eo3BJB8MXKQx05MOQ';
const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ?').get(PROJECT_ID) as { space_id: string };

const CLS_CONTENT = await fs.readFile(path.join(import.meta.dirname, 'my_cv.cls.txt'), 'utf-8');

const TEX_CONTENT = await fs.readFile(path.join(import.meta.dirname, 'resume.tex.txt'), 'utf-8');

const FONT_SOURCES: Record<string, string> = {
  'fonts/ArialMT-Light.ttf': '/System/Library/Fonts/Supplemental/Arial.ttf',
  'fonts/ArialMT-Medium.ttf': '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'fonts/ArialMT-Italic.ttf': '/System/Library/Fonts/Supplemental/Arial Italic.ttf',
};

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-'));
await fs.writeFile(path.join(workDir, 'main.tex'), TEX_CONTENT, 'utf-8');
await fs.writeFile(path.join(workDir, 'my_cv.cls'), CLS_CONTENT, 'utf-8');
await fs.mkdir(path.join(workDir, 'fonts'), { recursive: true });
for (const [rel, src] of Object.entries(FONT_SOURCES)) {
  await fs.copyFile(src, path.join(workDir, rel));
}

await writeFile({ space_id: project.space_id, path: 'resume.tex', title: 'Zachary Starnes — Resume', body: TEX_CONTENT, tags: { type: 'resume-source' } });
await writeFile({ space_id: project.space_id, path: 'my_cv.cls', title: 'my_cv.cls', body: CLS_CONTENT, tags: { type: 'latex-class' } });
for (const rel of Object.keys(FONT_SOURCES)) {
  const data = await fs.readFile(path.join(workDir, rel));
  await writeBinaryFile({ space_id: project.space_id, path: rel, title: rel, mime_type: 'font/ttf', data, tags: { type: 'font', note: 'placeholder system Arial, swap with real font files if available' } });
}

try {
  await execFileAsync('tectonic', ['main.tex', '--outdir', workDir], { cwd: workDir, timeout: 60_000 });
} catch (err) {
  console.error('COMPILE FAILED');
  console.error((err as { stderr?: string }).stderr ?? String(err));
  await fs.rm(workDir, { recursive: true, force: true });
  process.exit(1);
}

const pdfData = await fs.readFile(path.join(workDir, 'main.pdf'));
await fs.rm(workDir, { recursive: true, force: true });
const pdfFile = await writeBinaryFile({ space_id: project.space_id, path: 'resume.pdf', title: 'Zachary Starnes — Resume', mime_type: 'application/pdf', data: pdfData, tags: { type: 'resume' } });
console.log('OK', JSON.stringify(pdfFile));
