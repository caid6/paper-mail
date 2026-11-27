import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const product = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const appName = product.build.productName;
const appPath = path.join(release, `mac-${process.arch}`, `${appName}.app`);
const stage = path.join(release, `${appName}-dmg`);
const image = path.join(release, `${appName}-${product.version}-${process.arch}.dmg`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(appPath, path.join(stage, `${appName}.app`), { recursive: true, verbatimSymlinks: true });
symlinkSync('/Applications', path.join(stage, 'Applications'), 'dir');

try {
  execFileSync('/usr/bin/hdiutil', [
    'create',
    '-volname', appName,
    '-srcfolder', stage,
    '-ov',
    '-format', 'UDZO',
    image,
  ], { stdio: 'inherit' });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
