import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { checkPython, projectPython, resourcesRoot, userDataRoot } from './python-runtime.mjs';

const external = process.env.PAPER_DOWNLOAD_PYTHON;
const python = external || projectPython;
const venv = path.join(userDataRoot, '.venv');
const requirements = path.join(resourcesRoot, 'requirements.txt');
const run = (program, args) => execFileSync(program, args, {stdio:'inherit'});

function usable(command, modules = false) {
  try { checkPython(command, modules); return true; } catch { return false; }
}

function hasCommand(program, args) {
  return spawnSync(program, args, {stdio:'ignore', timeout:10000}).status === 0;
}

function installDependencies() {
  console.log('正在安装 PDF 依赖。首次下载 PyMuPDF 可能需要几分钟，下方会显示下载进度。');
  if (!hasCommand(python, ['-m', 'pip', '--version'])) {
    console.log('正在为 Python 环境准备依赖安装工具。');
    if (hasCommand(python, ['-m', 'ensurepip', '--version'])) {
      run(python, ['-m', 'ensurepip', '--default-pip']);
    } else if (hasCommand('uv', ['--version'])) {
      run('uv', ['pip', 'install', '--python', python, '-r', requirements]);
      return;
    } else {
      throw new Error('此 Python 环境无法安装 pip。请使用带 ensurepip 的 Python，或安装 uv。');
    }
  }
  run(python, ['-m', 'pip', 'install', '--progress-bar', 'on', '-r', requirements]);
}

function setup() {
  console.log('正在检查项目的 PDF 环境。');
  if (usable(python, true)) {
    console.log('PDF 环境已就绪，沿用现有依赖。');
    return;
  }

  let backupDirectory;
  let rebuilding = false;
  try {
    if (!usable(python)) {
      const base = external || process.env.PAPER_MAIL_SETUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
      if (!usable(base)) {
        console.error('找不到可用的 Python 3.11 或更新版本，请安装 Python 或检查已配置的解释器路径。');
        process.exitCode = 2;
        return;
      }
      if (lstatSync(venv, {throwIfNoEntry:false})) {
        const runtime = path.join(userDataRoot, '.runtime');
        mkdirSync(runtime, {recursive:true});
        backupDirectory = mkdtempSync(path.join(runtime, 'python-backup-'));
        renameSync(venv, path.join(backupDirectory, '.venv'));
      }
      rebuilding = true;
      console.log('正在创建项目 Python 虚拟环境。');
      run(base, ['-m', 'venv', venv]);
    }
    installDependencies();
    checkPython(python, true);
    console.log('PDF 环境已就绪。');
    if (backupDirectory) console.log('原虚拟环境已移至 ' + path.relative(userDataRoot, backupDirectory));
  } catch (error) {
    if (rebuilding) {
      rmSync(venv, {recursive:true, force:true});
      if (backupDirectory) renameSync(path.join(backupDirectory, '.venv'), venv);
    }
    console.error('PDF 依赖安装未完成。' + error.message);
    console.error('检查网络和软件源后，可以重新运行 npm run setup:python。');
    process.exitCode = 1;
  }
}

setup();
