import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const projectPython = path.join(projectRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const systemPython = process.platform === 'win32' ? 'python' : 'python3';

export function pythonExecutable() {
  return process.env.PAPER_DOWNLOAD_PYTHON || (existsSync(projectPython) ? projectPython : systemPython);
}

export function checkPython(command = pythonExecutable(), modules = false) {
  const probe = 'import sys; assert sys.version_info >= (3, 11)' + (modules ? '; import pypdf, pymupdf, certifi' : '');
  execFileSync(command, ['-c', probe], {stdio:'ignore', timeout:10000});
}
