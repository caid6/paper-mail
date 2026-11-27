import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cp as cpAsync } from 'node:fs/promises';
import path from 'node:path';

app.setName('Paper-mail');
if (process.platform === 'win32') app.setAppUserModelId('com.caid6.papermail');

function esbuildPlatformPackage() {
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
    throw new Error(`不支持的桌面平台：${process.platform}`);
  }
  if (!['arm64', 'x64', 'ia32'].includes(process.arch)) {
    throw new Error(`不支持的桌面架构：${process.arch}`);
  }
  return `${process.platform}-${process.arch}`;
}

if (app.isPackaged) {
  process.env.ESBUILD_BINARY_PATH = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@esbuild',
    esbuildPlatformPackage(),
    ...(process.platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild']),
  );
}
const { register } = await import('tsx/esm/api');
register();

const hasInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let backendServer;
let backendModule;
let backendURL;
let dataRoot;
let electronDataRoot;
let storagePreferencePath;
let scriptRoot;
let backendStopped = false;

function resolveContainedPath(root, relativePath, label) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error(`PDF 运行时清单中的${label}路径无效`);
  }
  const resolved = path.resolve(root, relativePath);
  if (!pathContains(root, resolved)) throw new Error(`PDF 运行时清单中的${label}路径越界`);
  return resolved;
}

function configurePackagedPdfRuntime() {
  const runtimeRoot = path.join(process.resourcesPath, 'pdf-runtime');
  const manifestPath = path.join(runtimeRoot, 'runtime.json');
  if (!existsSync(manifestPath)) throw new Error('安装包缺少 PDF 运行时清单，请重新安装 Paper-mail。');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('PDF 运行时清单无法读取，请重新安装 Paper-mail。');
  }
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) {
    throw new Error('安装包中的 PDF 运行时与当前系统架构不匹配，请下载对应版本。');
  }
  const python = resolveContainedPath(runtimeRoot, manifest.pythonExecutable, 'Python');
  const sitePackages = resolveContainedPath(runtimeRoot, manifest.sitePackages, '依赖');
  if (!existsSync(python) || !existsSync(sitePackages)) {
    throw new Error('安装包中的 PDF 运行时不完整，请重新安装 Paper-mail。');
  }
  process.env.PAPER_DOWNLOAD_PYTHON = python;
  process.env.PYTHONPATH = [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
}

if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendURL) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (backendServer && !backendStopped) backendServer.close();
  });
}

async function startApplication() {
  await app.whenReady();
  electronDataRoot = app.getPath('userData');
  storagePreferencePath = path.join(app.getPath('appData'), 'Paper-mail-storage-location.json');
  const storedRoot = readStoragePreference(storagePreferencePath);
  const configuredRoot = process.env.PAPER_MAIL_USER_DATA_DIR || storedRoot;
  if (storedRoot && !process.env.PAPER_MAIL_USER_DATA_DIR && !existsSync(storedRoot)) {
    throw new Error(`本机数据目录不可用：${storedRoot}`);
  }
  if (configuredRoot && !path.isAbsolute(configuredRoot)) {
    throw new Error('PAPER_MAIL_USER_DATA_DIR 必须是绝对路径');
  }
  dataRoot = path.resolve(configuredRoot || electronDataRoot);
  scriptRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
  mkdirSync(electronDataRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  process.chdir(electronDataRoot);
  process.env.PAPER_MAIL_DESKTOP = '1';
  process.env.PAPER_MAIL_APP_ROOT = app.getAppPath();
  process.env.PAPER_MAIL_USER_DATA_DIR = dataRoot;
  process.env.PAPER_MAIL_SCRIPT_ROOT = scriptRoot;
  process.env.DOTENV_CONFIG_PATH = path.join(dataRoot, '.env');
  if (app.isPackaged) configurePackagedPdfRuntime();
  process.env.PORT = '0';

  installApplicationMenu();
  backendModule = await import('../server/index.ts');
  backendServer = backendModule.server;
  const { serverReady } = backendModule;
  await serverReady;
  const address = backendServer.address();
  if (!address || typeof address === 'string') throw new Error('本机服务没有提供有效地址');
  backendURL = `http://127.0.0.1:${address.port}`;
  await createWindow();
}

function installApplicationMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '显示',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f9fc',
    title: '研邮 Paper-mail',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
    },
  });
  mainWindow = window;

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(backendURL).origin) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  try {
    await window.loadURL(backendURL);
  } catch (error) {
    dialog.showErrorBox('Paper-mail 无法打开', error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

function readStoragePreference(filename) {
  if (!existsSync(filename)) return '';
  const value = JSON.parse(readFileSync(filename, 'utf8'));
  if (typeof value.path !== 'string' || !path.isAbsolute(value.path)) {
    throw new Error('本机存储位置配置无效');
  }
  return path.resolve(value.path);
}

function writeStoragePreference(filename, folder) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ path: folder }) + '\n', { mode: 0o600 });
  renameSync(temporary, filename);
}

function pathContains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertMainWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('不允许此窗口执行本机文件操作');
}

ipcMain.handle('paper-mail:open-pdf-folder', async (event, paperId) => {
  assertMainWindow(event);
  if (typeof paperId === 'string' && paperId) {
    const file = backendModule?.localPdfPath(paperId);
    if (!file || !existsSync(file)) throw new Error('这篇论文的 PDF 尚未保存在本机');
    shell.showItemInFolder(file);
    return;
  }
  const folder = path.join(dataRoot, 'data', 'downloads');
  mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
});

ipcMain.handle('paper-mail:change-storage-location', async (event) => {
  assertMainWindow(event);
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: '选择存储位置',
    buttonLabel: '选择此文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };

  const destination = path.resolve(selection.filePaths[0]);
  const parent = path.dirname(destination);
  const current = path.resolve(dataRoot);
  if (destination === current) return { canceled: true };
  if (pathContains(current, destination) || pathContains(destination, current)) {
    throw new Error('请选择与当前数据目录分开的文件夹。');
  }

  const destinationExists = existsSync(destination);
  const hasPaperMailDatabase = destinationExists && existsSync(path.join(destination, 'data', 'papers.sqlite'));
  if (destinationExists && !hasPaperMailDatabase && readdirSync(destination).length) {
    throw new Error('目标目录中已有其他文件。请选择空文件夹或已有研邮数据目录。');
  }

  const action = hasPaperMailDatabase ? '切换并重启' : '复制并重启';
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: [action, '取消'],
    defaultId: 1,
    cancelId: 1,
    message: hasPaperMailDatabase ? '此位置已有研邮数据' : '更改本机存储位置？',
    detail: hasPaperMailDatabase
      ? `将切换到已有数据目录：\n${destination}\n\n当前目录的数据会保留。`
      : `文献库、PDF、图表和模型配置会复制到：\n${destination}\n\n迁移后应用会重启，原目录的数据会保留。`,
  });
  if (confirmation.response !== 0) return { canceled: true };

  let stopped = false;
  let staging = '';
  try {
    await backendModule.stopForStorageRelocation();
    backendStopped = true;
    stopped = true;

    if (!hasPaperMailDatabase) {
      staging = path.join(parent, `.Paper-mail-migration-${process.pid}`);
      if (existsSync(staging)) throw new Error('迁移临时目录已存在，请删除后重试。');
      await cpAsync(dataRoot, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      if (existsSync(destination)) {
        if (readdirSync(destination).length) throw new Error('目标目录在迁移过程中出现了新文件。');
        rmSync(destination, { recursive: true });
      }
      renameSync(staging, destination);
      staging = '';
    }

    writeStoragePreference(storagePreferencePath, destination);
    process.env.PAPER_MAIL_USER_DATA_DIR = destination;
    app.relaunch();
    app.quit();
    return { canceled: false, restarting: true };
  } catch (error) {
    if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (stopped) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['好'],
        message: '存储位置迁移未完成',
        detail: `${error instanceof Error ? error.message : String(error)}\n原数据仍保留在：${current}`,
      });
      app.relaunch();
      app.quit();
      return { canceled: false, restarting: true };
    }
    throw error;
  }
});

function openExternal(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return;
  }
  if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) return;
  void shell.openExternal(target.href).catch(console.error);
}

if (hasInstanceLock) {
  startApplication().catch((error) => {
    console.error(error);
    dialog.showErrorBox('Paper-mail 启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
