#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  if (process.env.SKIP_MACOS_SECURITY_CHECK === '1') {
    console.log('[macos-verify] Skipping signature/notarization checks (SKIP_MACOS_SECURITY_CHECK=1).');
    return;
  }

  const appPath = await resolveAppPath();

  const codesignOutput = await runCodesign(appPath);
  const isAdhoc = /Signature=adhoc/.test(codesignOutput);
  const missingTeamId = /TeamIdentifier=not set/.test(codesignOutput);

  if (isAdhoc || missingTeamId) {
    throw new Error(
      [
        'macOS app is not Developer ID signed.',
        'Found ad-hoc signature metadata in codesign output.',
        'Build and sign with your Apple Developer ID identity before publishing.'
      ].join(' ')
    );
  }

  await runSpctl(appPath);
  console.log(`[macos-verify] Gatekeeper assessment passed for ${appPath}`);
}

async function resolveAppPath() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = dirname(scriptDir);

  const explicitPathArg = process.argv[2];
  if (explicitPathArg) {
    if (!existsSync(explicitPathArg)) {
      throw new Error(`App path not found: ${explicitPathArg}`);
    }
    return explicitPathArg;
  }

  const appDir = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos');
  if (!existsSync(appDir)) {
    throw new Error(`macOS app bundle directory not found: ${appDir}. Run npm run tauri:build first.`);
  }

  const { stdout } = await execFileAsync('zsh', ['-lc', `ls -td "${appDir}"/*.app 2>/dev/null | head -n 1`]);
  const appPath = stdout.trim();
  if (!appPath) {
    throw new Error(`No .app bundle found in ${appDir}. Run npm run tauri:build first.`);
  }

  return appPath;
}

async function runCodesign(appPath) {
  try {
    const { stdout, stderr } = await execFileAsync('codesign', ['-dv', '--verbose=4', appPath]);
    return `${stdout}${stderr}`;
  } catch (error) {
    throw new Error(
      [
        `codesign inspection failed for ${appPath}.`,
        'Ensure Xcode command line tools are installed and the app bundle exists.',
        error.stderr || error.message
      ].join(' ')
    );
  }
}

async function runSpctl(appPath) {
  try {
    await execFileAsync('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  } catch (error) {
    throw new Error(
      [
        `Gatekeeper rejected ${appPath}.`,
        'The app must be Developer ID signed and notarized before publishing.',
        error.stderr || error.message
      ].join(' ')
    );
  }
}

main().catch((error) => {
  console.error(`[macos-verify] ${error.message}`);
  process.exitCode = 1;
});

