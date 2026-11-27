import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export const projectRoot = path.resolve(process.env.PAPER_MAIL_APP_ROOT || fileURLToPath(new URL('../', import.meta.url)));
export const resourcesRoot = path.resolve(process.env.PAPER_MAIL_SCRIPT_ROOT || projectRoot);
export const userDataRoot = path.resolve(process.env.PAPER_MAIL_USER_DATA_DIR || projectRoot);
export const projectPython = path.join(userDataRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const systemPython = process.platform === 'win32' ? 'python' : 'python3';

export function pythonExecutable() {
  return process.env.PAPER_DOWNLOAD_PYTHON || (existsSync(projectPython) ? projectPython : systemPython);
}

export function checkPython(command = pythonExecutable(), modules = false) {
  const probe = 'import sys; assert sys.version_info >= (3, 11)' + (modules ? '; import pypdf, pymupdf, certifi' : '');
  execFileSync(command, ['-c', probe], {stdio:'ignore', timeout:10000});
}
