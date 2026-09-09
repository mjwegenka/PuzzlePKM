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

  // The DMG is what actually gets published, and notarizing the app does not
  // notarize its wrapper: a disk image has to be submitted in its own right and
  // stapled. Checking only the .app once let an unnotarized DMG ship, which
  // greets everyone who downloads it with a Gatekeeper warning.
  const dmgPath = await resolveDmgPath();
  if (!dmgPath) {
    console.log('[macos-verify] No DMG found next to the app bundle; skipping disk image checks.');
    return;
  }
  await runSpctlOpen(dmgPath);
  await runStaplerValidate(dmgPath);
  console.log(`[macos-verify] Gatekeeper assessment and stapled ticket verified for ${dmgPath}`);
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

async function resolveDmgPath() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = dirname(scriptDir);

  const explicitDmgArg = process.argv[3];
  if (explicitDmgArg) {
    if (!existsSync(explicitDmgArg)) {
      throw new Error(`DMG path not found: ${explicitDmgArg}`);
    }
    return explicitDmgArg;
  }

  const dmgDir = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  if (!existsSync(dmgDir)) return null;

  const { stdout } = await execFileAsync('zsh', ['-lc', `ls -td "${dmgDir}"/*.dmg 2>/dev/null | head -n 1`]);
  return stdout.trim() || null;
}

async function runSpctlOpen(dmgPath) {
  // `--type execute` is for executables; a disk image is assessed as something
  // the user opens, against its own signature.
  try {
    await execFileAsync('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath]);
  } catch (error) {
    throw new Error(
      [
        `Gatekeeper rejected ${dmgPath}.`,
        'The disk image itself must be notarized, not just the app inside it:',
        'xcrun notarytool submit <dmg> --apple-id <id> --password <app-specific> --team-id <team> --wait',
        error.stderr || error.message
      ].join(' ')
    );
  }
}

async function runStaplerValidate(dmgPath) {
  // Without a stapled ticket the check depends on Apple being reachable, so a
  // user offline on first launch still sees a warning.
  try {
    await execFileAsync('xcrun', ['stapler', 'validate', dmgPath]);
  } catch (error) {
    throw new Error(
      [
        `No notarization ticket is stapled to ${dmgPath}.`,
        'Run: xcrun stapler staple <dmg>',
        error.stdout || error.stderr || error.message
      ].join(' ')
    );
  }
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

