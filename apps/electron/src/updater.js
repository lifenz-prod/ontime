/**
 * One-click updates from the GitHub releases.
 *
 * The app window finds the release and shows its notes; once the user confirms, it asks us
 * to install that release's tag. Only the app on the host machine can do this, browsers
 * on other devices are pointed to the download. We download the installer for this platform,
 * check it, then quit and let a detached helper swap it in and relaunch:
 * - macOS: the signed zip is unpacked, its signature verified and the .app bundle replaced
 * - Windows: the NSIS installer runs silently and relaunches the app
 * - Linux: the AppImage file is replaced (only when running from an AppImage)
 */

const { app } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const releasesUrl = 'https://github.com/lifenz-prod/ontime/releases/download';

/** the installer published with each release for this platform, or null if we can not update in place */
function getAssetName() {
  if (process.platform === 'darwin') {
    return `ontime-macOS-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip`;
  }
  if (process.platform === 'win32') {
    return 'ontime-win64.exe';
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return 'ontime-linux.AppImage';
  }
  return null;
}

/** whether this install can update itself, and why not */
function getUpdateSupport() {
  if (!app.isPackaged) {
    return { supported: false, reason: 'Updates only work in the installed app' };
  }
  if (!getAssetName()) {
    return { supported: false, reason: 'This install can not update itself, download the new version instead' };
  }
  return { supported: true, reason: '' };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

/** downloads with progress reports, as a fraction from 0 to 1 */
async function download(url, destination, onProgress) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    if (response.status === 404) {
      throw new Error('This release has no installer for this computer');
    }
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastReported = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const fraction = total ? received / total : 0;
      if (fraction - lastReported >= 0.01) {
        lastReported = fraction;
        onProgress(fraction);
      }
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(destination));
  if (total && received !== total) {
    throw new Error('The download was incomplete');
  }
  onProgress(1);
}

/** where the running .app bundle lives, eg. /Applications/ontime.app */
function getMacAppPath() {
  return path.resolve(process.execPath, '..', '..', '..');
}

async function prepareMac(zipPath, workDir) {
  const extractDir = path.join(workDir, 'app');
  await run('ditto', ['-x', '-k', zipPath, extractDir]);
  const appName = fs.readdirSync(extractDir).find((name) => name.endsWith('.app'));
  if (!appName) {
    throw new Error('The download did not contain the app');
  }
  const newApp = path.join(extractDir, appName);
  // refuse anything that is not intact and signed
  await run('codesign', ['--verify', '--deep', '--strict', newApp]);

  const currentApp = getMacAppPath();
  // replace the bundle once we have quit, keeping the old one until the new one is in place
  const script = [
    'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done',
    'rm -rf "$3.old"',
    'if mv "$3" "$3.old" && mv "$2" "$3"; then rm -rf "$3.old"; else mv "$3.old" "$3"; fi',
    'rm -rf "$4"',
    'open "$3"',
  ].join('\n');
  return () =>
    spawn('/bin/sh', ['-c', script, 'ontime-update', String(process.pid), newApp, currentApp, workDir], {
      detached: true,
      stdio: 'ignore',
    }).unref();
}

function prepareWindows(installerPath) {
  // silent install, then start the app again
  return () =>
    spawn(installerPath, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
}

function prepareLinux(downloadPath, workDir) {
  fs.chmodSync(downloadPath, 0o755);
  const currentImage = process.env.APPIMAGE;
  const script = [
    'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done',
    'mv -f "$2" "$3"',
    'rm -rf "$4"',
    '"$3" >/dev/null 2>&1 &',
  ].join('\n');
  return () =>
    spawn('/bin/sh', ['-c', script, 'ontime-update', String(process.pid), downloadPath, currentImage, workDir], {
      detached: true,
      stdio: 'ignore',
    }).unref();
}

/**
 * Downloads and installs a release, then quits so it can be swapped in
 * @param {string} tag - the release tag, eg. v4.0.2-beta.7
 * @param {(fraction: number) => void} onProgress
 * @param {() => void} quit - closes the app for good
 */
async function installRelease(tag, onProgress, quit) {
  const support = getUpdateSupport();
  if (!support.supported) {
    throw new Error(support.reason);
  }
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error('Unknown release');
  }

  const assetName = getAssetName();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontime-update-'));
  try {
    const downloadPath = path.join(workDir, assetName);
    await download(`${releasesUrl}/${tag}/${assetName}`, downloadPath, onProgress);

    let launchInstaller;
    if (process.platform === 'darwin') {
      launchInstaller = await prepareMac(downloadPath, workDir);
    } else if (process.platform === 'win32') {
      launchInstaller = prepareWindows(downloadPath);
    } else {
      launchInstaller = prepareLinux(downloadPath, workDir);
    }

    launchInstaller();
    quit();
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { getUpdateSupport, installRelease };
