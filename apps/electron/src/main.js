const { app, BrowserWindow, Menu, globalShortcut, Tray, dialog, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const { getApplicationMenu } = require('./menu/applicationMenu.js');
const { getTrayMenu } = require('./menu/trayMenu.js');

const electronConfig = require('./electron.config.js');
const {
  env,
  isProduction,
  isWindows,
  nodePath,
  getClientUrl,
  trayIcon,
  appIcon,
  getServerUrl,
} = require('./externals.js');

if (!isProduction) {
  console.log(`Electron running in ${env} environment`);
  console.log(`Ontime server at ${nodePath}`);
  process.traceProcessWarnings = true;
}

/** Flag holds server loading state */
let loaded = 'Ontime starting';

/**
 * Flag whether user has requested a quit
 * Used to coordinate window closes without exit
 */
let isQuitting = false;

// initialise
let win;
let splash;
let tray = null;

/**
 * Coordinates the node process startup
 * @returns {number} server port - the port at which the backend has been started at
 */
async function startBackend() {
  // in dev mode, we expect both UI and server to be running
  if (!isProduction) {
    return;
  }

  const ontimeServer = require(nodePath);
  const { initAssets, startServer, startIntegrations } = ontimeServer;

  await initAssets();

  const result = await startServer(escalateError);
  loaded = result.message;

  await startIntegrations();

  return result.serverPort;
}

/**
 * @description utility function to create a notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
function showNotification(title, body) {
  new Notification({
    title,
    body,
    silent: true,
  }).show();
}

/**
 * Terminate node service and close electron app
 */
function appShutdown() {
  // terminate node service
  (async () => {
    const ontimeServer = require(nodePath);
    const { shutdown } = ontimeServer;
    await shutdown(electronConfig.appIni.shutdownCode);
  })();

  isQuitting = true;
  tray.destroy();
  win.destroy();
  app.quit();
}

/**
 * Sets Ontime window in focus
 */
function bringToFront() {
  win.show();
  win.focus();
}

/**
 * Coordinates the shutdown process
 */
function askToQuit() {
  bringToFront();
  win.send('user-request-shutdown');
}

/**
 * Allows processes to escalate errors to be shown in electron
 * @param {string} error
 */
function escalateError(error, unrecoverable = false) {
  if (unrecoverable) {
    dialog.showErrorBox('An unrecoverable error occurred', error);
    appShutdown();
  } else {
    dialog.showErrorBox('An error occurred', error);
  }
}

/**
 * Allows electron to ask the react app to redirect
 * @param {string} location
 */
function redirectWindow(location) {
  win.webContents.send('request-editor-location', location);
}

/**
 * Asks the react app to show a user dialog
 * @param {string} name
 */
function showDialog(name) {
  win.webContents.send('dialog', name);
}

/**
 * Path to a small JSON file tracking whether the auto-launch default
 * has been applied. Lives in userData so it survives app updates.
 * Must be called after the app is ready (app.getPath('userData')).
 */
function getAutoLaunchFlagPath() {
  return path.join(app.getPath('userData'), 'auto-launch.json');
}

/**
 * @returns {boolean} whether the user has explicitly chosen an auto-launch
 * preference. Until they do, we treat auto-launch as opt-out (default on).
 */
function hasAutoLaunchPreference() {
  try {
    return fs.existsSync(getAutoLaunchFlagPath());
  } catch (_error) {
    return false;
  }
}

/**
 * Records that an explicit auto-launch preference now exists, so the
 * default-on logic never overrides the user's choice again.
 */
function markAutoLaunchPreference() {
  try {
    fs.writeFileSync(getAutoLaunchFlagPath(), JSON.stringify({ initialised: true }));
  } catch (_error) {
    /** best-effort persistence */
  }
}

/**
 * Auto-launch defaults to ON. The first time the packaged app runs (no stored
 * preference yet), enable launch-on-login; the user can then opt out via the
 * Feature Settings toggle. Guarded to production so dev runs don't register
 * the bundled electron binary as a login item.
 */
function applyDefaultAutoLaunch() {
  if (!isProduction || hasAutoLaunchPreference()) {
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: true });
  } catch (_error) {
    /** OS login-item registry unavailable */
  }
  markAutoLaunchPreference();
}

// Ensure there isn't another instance of the app running already
const lock = app.requestSingleInstanceLock();
if (!lock) {
  dialog.showErrorBox('Multiple instances', 'An instance of the App is already running.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      bringToFront();
    }
  });
}

/**
 * Coordinates creation of electron windows (splash and main)
 */
function createWindow() {
  splash = new BrowserWindow({
    width: 333,
    height: 333,
    transparent: true,
    icon: appIcon,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
  });
  splash.setIgnoreMouseEvents(true);
  const splashPath = path.join('file://', __dirname, '/splash/splash.html');
  splash.loadURL(splashPath);

  win = new BrowserWindow({
    width: 1920,
    height: 1000,
    minWidth: 525,
    minHeight: 405,
    backgroundColor: '#101010', // $gray-1350
    icon: appIcon,
    show: false,
    textAreasAreResizable: false,
    enableWebSQL: false,
    darkTheme: true,
    webPreferences: {
      preload: path.join(__dirname, './preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.setMenu(null);
}

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  // Set app title in windows
  if (isWindows) {
    app.setAppUserModelId(app.name);
  }

  // Auto-launch is opt-out: enable it by default on first run
  applyDefaultAutoLaunch();

  createWindow();
  startBackend()
    .then((port) => {
      const clientUrl = getClientUrl(port);
      const serverUrl = getServerUrl(port);
      const menu = getApplicationMenu(askToQuit, clientUrl, serverUrl, redirectWindow, showDialog, (url) =>
        win.webContents.downloadURL(url),
      );
      Menu.setApplicationMenu(menu);

      win
        .loadURL(`${clientUrl}/editor`)
        .then(() => {
          win.webContents.setBackgroundThrottling(false);

          win.show();
          win.focus();

          splash.destroy();

          if (typeof loaded === 'string') {
            tray.setToolTip(loaded);
          } else {
            tray.setToolTip('Initialising error: please restart Ontime');
          }
        })
        .catch((error) => {
          console.log('ERROR: Ontime failed to reach server', error);
        });
    })
    .catch((error) => {
      console.log('ERROR: Ontime failed to start', error);
    });

  /**
   * recreate window if no others open
   */
  app.on('activate', () => {
    win.show();
  });

  /**
   * Hide on close
   */
  win.on('close', function (event) {
    event.preventDefault();
    if (!isQuitting) {
      showNotification('Window Closed', 'App running in background');
      win.hide();
    }
  });

  // create tray and set its context menu
  tray = new Tray(trayIcon);
  const trayContextMenu = getTrayMenu(bringToFront, askToQuit);
  tray.setContextMenu(trayContextMenu);
});

/**
 * Unregister shortcuts before quitting
 */
app.once('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Ask for main window reload
// Test message
ipcMain.on('reload', () => {
  win?.reload();
});

// Terminate
ipcMain.on('shutdown', () => {
  console.log('Electron got IPC shutdown');
  appShutdown();
});

/**
 * Handles requests to set window properties
 */
ipcMain.on('set-window', (_event, arg) => {
  switch (arg) {
    case 'show-dev':
      win.webContents.openDevTools({ mode: 'detach' });
      break;
    default:
      console.log('Electron unhandled window request', arg);
  }
});

/**
 * Handles requests to open external links
 */
ipcMain.on('send-to-link', (_event, arg) => {
  try {
    shell.openExternal(arg);
  } catch (_error) {
    /** unhandled error */
  }
});

/**
 * Reports whether the app is configured to launch on system login.
 * Works on macOS and Windows via the OS login-item registry.
 */
ipcMain.handle('get-auto-launch', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (_error) {
    return false;
  }
});

/**
 * Enables or disables launching the app on system login.
 * Works on macOS and Windows via the OS login-item registry.
 */
ipcMain.on('set-auto-launch', (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch (_error) {
    /** unhandled error */
  }
  // record that the user has made an explicit choice so the default-on
  // logic never overrides it on a later launch
  markAutoLaunchPreference();
});
