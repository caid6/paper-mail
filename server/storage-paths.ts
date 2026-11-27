import path from 'node:path';

export function storageRoot(root: string) {
  return path.resolve(process.env.PAPER_MAIL_USER_DATA_DIR || root);
}

export function storagePath(root: string, ...parts: string[]) {
  return path.join(storageRoot(root), ...parts);
}

export function scriptPath(root: string, ...parts: string[]) {
  return path.join(process.env.PAPER_MAIL_SCRIPT_ROOT || root, ...parts);
}
