/**
 * Ontime Cue Renderer
 *
 * A menu bar app for the ProPresenter machine. It renders Ontime views off-screen and publishes them
 * as Syphon sources, so ProPresenter takes the timer as a video input instead of loading a web page.
 */
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');

const { knownViews, limits, normaliseConfig } = require('./config.js');
const { Output } = require('./output.js');

const configPath = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return { config: normaliseConfig(JSON.parse(fs.readFileSync(configPath, 'utf8'))), isFirstRun: false };
  } catch {
    return { config: normaliseConfig({}), isFirstRun: !fs.existsSync(configPath) };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

let { config, isFirstRun } = readConfig();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Ontime is usually reached over plain http on the LAN, where browsers refuse to run service workers.
// Trusting the configured server lets Ontime's page cache work, so a reload survives a network blip
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', config.serverUrl);

const outputs = config.outputs.map((_, index) => new Output(index, () => refreshStatus()));

let tray = null;
let lastMenuKey = null;
let settingsWindow = null;

function applyConfig() {
  outputs.forEach((output, index) => output.apply(config.serverUrl, config.outputs[index]));
  refreshStatus();
}

const statusLabels = {
  disabled: 'Off',
  loading: 'Connecting',
  live: 'Live',
  stale: 'No updates',
  offline: 'Offline',
  fault: 'Fault',
};

function getViewLabel(view) {
  return knownViews.find((known) => known.path === view)?.label ?? `/${view}`;
}

function refreshStatus() {
  if (tray) {
    const outputItems = outputs.map((output) => {
      const { name, status } = output.getSnapshot();
      const settings = config.outputs[output.index];
      return {
        label: `${output.index + 1}  ${name} — ${statusLabels[status]}  (${getViewLabel(settings.view)})`,
        enabled: false,
      };
    });

    // rebuilding the menu closes it if it is open, so only do it when something on it changed
    const menuKey = JSON.stringify([config.serverUrl, outputItems]);
    if (menuKey !== lastMenuKey) {
      lastMenuKey = menuKey;
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Ontime Cue Renderer', enabled: false },
          { label: config.serverUrl, enabled: false },
          { type: 'separator' },
          ...outputItems,
          { type: 'separator' },
          { label: 'Settings…', click: openSettings },
          { label: 'Reload outputs', click: () => outputs.forEach((output) => output.reload()) },
          {
            label: 'Open at login',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          { type: 'separator' },
          { label: 'Quit', role: 'quit' },
        ]),
      );
    }

    // the menu bar shows at a glance when something needs attention
    const enabled = outputs.map((output) => output.getSnapshot()).filter((snapshot) => snapshot.status !== 'disabled');
    const allLive = enabled.every((snapshot) => snapshot.status === 'live');
    tray.setTitle(allLive ? '' : ' !');
  }

  sendState();
}

function getState() {
  return {
    config,
    knownViews,
    limits,
    outputs: outputs.map((output) => output.getSnapshot()),
  };
}

function sendState() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:state', getState());
  }
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 820,
    title: 'Ontime Cue Renderer',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload-settings.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.handle('settings:get', () => getState());

ipcMain.handle('settings:save', (_event, rawConfig) => {
  const next = normaliseConfig(rawConfig);
  const serverChanged = next.serverUrl !== config.serverUrl;
  writeConfig(next);
  config = next;

  if (serverChanged) {
    // the trusted-origin switch can only be set at launch
    app.relaunch();
    app.exit(0);
    return getState();
  }

  applyConfig();
  return getState();
});

ipcMain.handle('settings:reload', (_event, index) => {
  outputs[index]?.reload();
});

ipcMain.handle('settings:previews', () => Promise.all(outputs.map((output) => output.capturePreview())));

ipcMain.on('view:heartbeat', (event, report) => {
  const output = outputs.find((candidate) => candidate.ownsContents(event.sender));
  output?.onHeartbeat(report ?? {});
});

app.on('second-instance', openSettings);

// the outputs are hidden windows, closing settings must not quit the app
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  app.dock?.hide();

  // keep macOS from napping a background app whose whole job is drawing frames
  powerSaveBlocker.start('prevent-app-suspension');

  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'background.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Ontime Cue Renderer');

  applyConfig();
  setInterval(refreshStatus, 1000);

  if (isFirstRun) {
    openSettings();
  }
});
