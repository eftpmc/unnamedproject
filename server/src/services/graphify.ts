import { spawn } from 'child_process';

export function indexWorkspace(repoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'graphify', 'index', repoPath], {
      cwd: repoPath,
      env: process.env,
    });
    proc.stderr.on('data', (d: Buffer) => console.error('[graphify index]', d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`graphify index exited with code ${code}`));
    });
  });
}

export function queryGraph(repoPath: string, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'graphify', 'query', '--repo', repoPath, '--q', question], {
      env: process.env,
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => console.error('[graphify query]', d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`graphify query exited with code ${code}`));
    });
  });
}
