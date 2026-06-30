import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { writeFile, writeBinaryFile } from '../../services/files.js';

const execFileAsync = promisify(execFile);

export function registerLatexHandlers(): void {
  registerTool({
    name: 'compile_latex',
    description: 'Compile LaTeX source into a PDF using Tectonic. Saves the .tex source and the rendered .pdf as files in the given project. The PDF is saved at the same path with a .pdf extension.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path for the .tex source, e.g. resume.tex' },
        title: { type: 'string' },
        body: { type: 'string', description: 'LaTeX source code' },
        tags: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
      },
      required: ['project_id', 'path', 'title', 'body'],
    },
    handler: async (args, _userId, sessionId) => {
      const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ?').get(args.project_id as string) as { space_id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;

      const texPath = args.path as string;
      if (!texPath.endsWith('.tex')) return 'Error: path must end in .tex';
      const pdfPath = texPath.slice(0, -4) + '.pdf';
      const tags = (args.tags as Record<string, unknown> | undefined) ?? {};
      const body = args.body as string;

      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-'));
      const texFile = path.join(workDir, 'main.tex');
      await fs.writeFile(texFile, body, 'utf-8');

      const sourceFile = await writeFile({
        space_id: project.space_id,
        path: texPath,
        title: args.title as string,
        tags,
        body,
        source_session_id: sessionId,
      });

      try {
        await execFileAsync('tectonic', ['main.tex', '--outdir', workDir], { cwd: workDir, timeout: 60_000 });
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? String(err);
        await fs.rm(workDir, { recursive: true, force: true });
        return JSON.stringify({ source: sourceFile, error: 'LaTeX compilation failed', log: stderr.slice(-4000) });
      }

      const pdfData = await fs.readFile(path.join(workDir, 'main.pdf'));
      await fs.rm(workDir, { recursive: true, force: true });

      const pdfFile = await writeBinaryFile({
        space_id: project.space_id,
        path: pdfPath,
        title: args.title as string,
        mime_type: 'application/pdf',
        data: pdfData,
        tags,
        source_session_id: sessionId,
      });

      return JSON.stringify({ source: sourceFile, pdf: pdfFile });
    },
  });
}
