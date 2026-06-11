import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '../db/index.js';

function graphDir(projectId: string): string {
  return path.join(getDataDir(), 'graphs', projectId);
}

function graphPath(projectId: string): string {
  return path.join(graphDir(projectId), 'graphify-out', 'graph.json');
}

export async function hasGraph(projectId: string): Promise<boolean> {
  try {
    await fs.access(graphPath(projectId));
    return true;
  } catch {
    return false;
  }
}

export async function buildGraph(repoPath: string, projectId: string): Promise<void> {
  await fs.mkdir(graphDir(projectId), { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('graphify', [repoPath, '--no-viz'], { cwd: graphDir(projectId) });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`graphify build exited with code ${code}`));
    });
  });
}

export async function queryGraph(question: string, projectId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('graphify', ['query', question], { cwd: graphDir(projectId) });
    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`graphify query exited with code ${code}`));
    });
  });
}
