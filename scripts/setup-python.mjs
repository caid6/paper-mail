import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPython, projectPython, projectRoot } from './python-runtime.mjs';

const external = process.env.PAPER_DOWNLOAD_PYTHON;
const base = external || process.env.PAPER_MAIL_SETUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
try {
  checkPython(base);
} catch {
  console.error('找不到可用的 Python 3.11 或更新版本。请安装后重试，或检查已配置的 Python 路径。');
  process.exit(2);
}

try {
  if (!external) execFileSync(base, ['-m', 'venv', path.join(projectRoot, '.venv')], {stdio:'inherit'});
  const python = external || projectPython;
  execFileSync(python, ['-m', 'pip', 'install', '-r', path.join(projectRoot, 'requirements.txt')], {stdio:'inherit'});
  checkPython(python, true);
  console.log('PDF 环境已就绪。');
} catch {
  console.error('PDF 依赖安装失败。请查看上方 pip 报错，检查软件源、网络与证书设置后，再运行 npm run setup:python。');
  process.exitCode = 1;
}
