import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '3.12.13';
const architecture = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null;
const supportedPlatforms = new Set(['darwin', 'win32']);

if (!supportedPlatforms.has(process.platform) || !architecture) {
  throw new Error('PDF 运行时只能在 macOS 或 Windows 的 arm64/x64 环境中构建。');
}
if (process.platform === 'win32' && process.arch !== 'x64') {
  throw new Error('Windows 桌面版当前只构建 x64，请在 x64 Windows 环境中打包。');
}

const output = path.join(root, 'build', 'pdf-runtime');
const pythonRoot = path.join(output, 'python');
const sitePackages = path.join(output, 'site-packages');
const uv = process.env.UV_BIN || 'uv';
const uvArchitecture = architecture;
const platformName = process.platform === 'darwin' ? 'macos' : 'windows';
const pythonFileName = process.platform === 'win32' ? 'python.exe' : 'python3.12';

rmSync(output, { recursive: true, force: true });
mkdirSync(pythonRoot, { recursive: true });
mkdirSync(sitePackages, { recursive: true });

const runtimeEnvironment = { ...process.env, UV_PYTHON_INSTALL_DIR: pythonRoot };
execFileSync(uv, ['python', 'install', '--install-dir', pythonRoot, '--no-bin', version], {
  cwd: root,
  env: runtimeEnvironment,
  stdio: 'inherit',
});

const python = path.resolve(execFileSync(uv, [
  'python', 'find', '--no-project', '--python-preference', 'only-managed', version,
], {
  cwd: root,
  env: runtimeEnvironment,
  encoding: 'utf8',
}).trim());
const relativePython = path.relative(pythonRoot, python);
if (!relativePython || relativePython === '..' || relativePython.startsWith(`..${path.sep}`) || path.isAbsolute(relativePython) || !existsSync(python) || !statSync(python).isFile()) {
  throw new Error(`uv 返回的 ${pythonFileName} 不在本次 PDF 运行时目录中。`);
}

execFileSync(uv, ['pip', 'install', '--python', python, '--target', sitePackages, '--only-binary=:all:', '-r', 'requirements-desktop.txt'], {
  cwd: root,
  env: runtimeEnvironment,
  stdio: 'inherit',
});
execFileSync(python, ['-c', 'import certifi, pymupdf, pypdf'], {
  cwd: root,
  env: { ...runtimeEnvironment, PYTHONPATH: sitePackages },
  stdio: 'inherit',
});

const relative = filename => path.relative(output, filename);
writeFileSync(
  path.join(output, 'runtime.json'),
  JSON.stringify({
    version,
    platform: process.platform,
    architecture: process.arch,
    uvArchitecture,
    pythonExecutable: relative(python),
    sitePackages: relative(sitePackages),
  }, null, 2) + '\n',
);

console.log(`PDF 运行时已准备：${platformName}-${process.arch}`);
