import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

function graphPath(repoPath: string): string {
  return path.join(repoPath, 'graphify-out', 'graph.json');
}

function buildEnv(apiKey?: string | null): NodeJS.ProcessEnv {
  if (!apiKey) return process.env;
  return { ...process.env, ANTHROPIC_API_KEY: apiKey };
}

export async function hasGraph(repoPath: string): Promise<boolean> {
  try {
    await fs.access(graphPath(repoPath));
    return true;
  } catch {
    return false;
  }
}

export async function buildGraph(repoPath: string, _projectId: string, apiKey?: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    // graphify outputs to <repoPath>/graphify-out/ when run from repoPath
    const proc = spawn('graphify', ['.', '--no-viz'], {
      cwd: repoPath,
      env: buildEnv(apiKey),
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`graphify build exited with code ${code}`));
    });
  });
}

export async function queryGraph(question: string, repoPath: string, apiKey?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('graphify', ['query', question], {
      cwd: repoPath,
      env: buildEnv(apiKey),
    });
    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(output.trim() || 'No matching information found in graph.');
      else reject(new Error(`graphify query exited with code ${code}`));
    });
  });
}
