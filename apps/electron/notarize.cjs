// afterSign hook for electron-builder macOS notarization.
// Configured via: "afterSign": "./notarize.cjs" in the build config.
//
// Primary auth: Apple ID + app-specific password (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
// Alternative:  App Store Connect API key — see commented block below.

const { notarize } = require('@electron/notarize');
const { execFile } = require('child_process');
const path = require('path');

// Stapling fetches the ticket from Apple's CDN, and that connection drops often enough on CI runners
// (error 68, "The network connection was lost") to fail whole releases. @electron/notarize claims to
// retry the staple, but its promise-retry callback never calls retry(), so the first failure is final.
// The notarization itself has already succeeded by then, so only the staple needs repeating.
const STAPLE_ATTEMPTS = 6;
const STAPLE_BACKOFF_MS = 20_000;

function staple(appPath) {
  return new Promise((resolve, reject) => {
    execFile('xcrun', ['stapler', 'staple', '-v', appPath], (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stdout}${stderr}`));
      else resolve();
    });
  });
}

async function stapleWithRetry(appPath) {
  for (let attempt = 1; ; attempt++) {
    try {
      await staple(appPath);
      return;
    } catch (error) {
      if (attempt >= STAPLE_ATTEMPTS) throw error;
      const wait = STAPLE_BACKOFF_MS * attempt;
      console.warn(`[notarize] Staple attempt ${attempt}/${STAPLE_ATTEMPTS} failed, retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS builds
  if (electronPlatformName !== 'darwin') return;

  // Skip if explicitly disabled (e.g. local unsigned builds via dist-mac:local)
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  // --- Apple ID + App-Specific Password (primary) ---
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // --- App Store Connect API Key (alternative — uncomment to use instead) ---
  // const appleApiKey     = process.env.APPLE_API_KEY;       // Key ID, e.g. "ABCDE12345"
  // const appleApiIssuer  = process.env.APPLE_API_ISSUER;    // Issuer UUID from App Store Connect
  // const appleApiKeyPath = process.env.APPLE_API_KEY_PATH   // Full path to the .p8 private key file
  //   || path.join(process.env.HOME, 'private_keys', `AuthKey_${appleApiKey}.p8`);

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      '[notarize] Skipping: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set.\n' +
      '           Set these environment variables to enable notarization.',
    );
    return;
  }

  console.log(`[notarize] Submitting ${appName} for notarization...`);

  try {
    await notarize({
      // Apple ID auth:
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,

      // App Store Connect API key auth (uncomment and remove above):
      // tool: 'notarytool',
      // appPath,
      // appleApiKey,
      // appleApiIssuer,
      // appleApiKeyPath,
    });
  } catch (error) {
    // only a failed staple is worth another go; a rejected notarization is not
    if (!/Failed to staple/.test(String(error?.message))) throw error;
    console.warn('[notarize] Notarized, but stapling failed — retrying the staple');
    await stapleWithRetry(appPath);
  }

  console.log(`[notarize] Done — ${appName} successfully notarized.`);
};
