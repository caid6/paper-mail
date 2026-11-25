import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkPython, projectRoot, pythonExecutable } from './python-runtime.mjs';

const python = pythonExecutable();
try {
  checkPython(python, true);
} catch {
  console.error('测试需要 Python 3.11+、pypdf、PyMuPDF 和 certifi。请先运行 npm run setup:python。');
  process.exit(1);
}
const tests = readdirSync(path.join(projectRoot, 'tests'))
  .filter(name => name.endsWith('.test.ts'))
  .map(name => path.join('tests', name));
const env = {...process.env, PAPER_DOWNLOAD_PYTHON:python};
for (const [program, args] of [
  [process.execPath, ['--import', 'tsx', '--test', ...tests]],
  [python, ['-m', 'unittest', 'discover', '-s', 'tests_python']],
]) {
  const result = spawnSync(program, args, {cwd:projectRoot, env, stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
