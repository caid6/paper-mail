import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '3.12.13';
const architecture = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null;
if (process.platform !== 'darwin' || !architecture) {
  throw new Error('PDF 运行时只能在 Apple Silicon 或 Intel Mac 上构建。');
}

const output = path.join(root, 'build', 'pdf-runtime');
const pythonRoot = path.join(output, 'python');
const python = path.join(pythonRoot, `cpython-${version}-macos-${architecture}-none`, 'bin', 'python3.12');
const sitePackages = path.join(output, 'site-packages');
const uv = process.env.UV_BIN || 'uv';
rmSync(output, { recursive: true, force: true });
mkdirSync(pythonRoot, { recursive: true });
mkdirSync(sitePackages, { recursive: true });

execFileSync(uv, ['python', 'install', '--install-dir', pythonRoot, '--no-bin', version], { cwd: root, stdio: 'inherit' });
execFileSync(uv, ['pip', 'install', '--python', python, '--target', sitePackages, '--only-binary=:all:', '-r', 'requirements-desktop.txt'], { cwd: root, stdio: 'inherit' });
execFileSync(python, ['-c', 'import certifi, pymupdf, pypdf'], {
  cwd: root,
  env: { ...process.env, PYTHONPATH: sitePackages },
  stdio: 'inherit',
});
