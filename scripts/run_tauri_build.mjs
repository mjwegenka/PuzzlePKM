#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

await main();

async function main() {
  await run('npm', ['run', 'version:sync']);

  const env = await buildTauriEnv();
  await run('tauri', ['build'], env);
  await notarizeDmg(env);
}

/**
 * `tauri build` submits the .app to Apple, then wraps it in a disk image
 * afterwards — and notarizing an app does not notarize its wrapper. The DMG is
 * what actually ships, so it has to be submitted in its own right and stapled,
 * or every download is met with a Gatekeeper warning. Without this the publish
 * step's own check (scripts/verify_macos_bundle.mjs) refuses to upload.
 */
async function notarizeDmg(env) {
  if (process.platform !== 'darwin') return;

  const dmgPath = await findLatestDmg();
  if (!dmgPath) {
    console.log('[tauri-build] No DMG produced; skipping disk image notarization.');
    return;
  }

  const appleId = String(env.APPLE_ID ?? '').trim();
  const password = String(env.APPLE_PASSWORD ?? '').trim();
  const teamId = String(env.APPLE_TEAM_ID ?? '').trim();
  if (!appleId || !password || !teamId) {
    console.log('[tauri-build] APPLE_ID, APPLE_PASSWORD or APPLE_TEAM_ID missing; leaving the DMG unnotarized.');
    console.log('[tauri-build] Publishing will refuse it until it is notarized and stapled.');
    return;
  }

  if (await isStapled(dmgPath)) {
    console.log(`[tauri-build] DMG already carries a stapled ticket: ${dmgPath}`);
    return;
  }

  console.log(`[tauri-build] Notarizing ${dmgPath} (this waits on Apple)…`);
  await run(
    'xcrun',
    ['notarytool', 'submit', dmgPath, '--apple-id', appleId, '--password', password, '--team-id', teamId, '--wait'],
    env,
  );
  await run('xcrun', ['stapler', 'staple', dmgPath], env);
  console.log(`[tauri-build] Notarized and stapled ${dmgPath}`);
}

async function findLatestDmg() {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const dmgDir = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  if (!existsSync(dmgDir)) return '';
  const { stdout } = await execFileAsync('zsh', ['-lc', `ls -td "${dmgDir}"/*.dmg 2>/dev/null | head -n 1`]);
  return stdout.trim();
}

async function isStapled(dmgPath) {
  try {
    await execFileAsync('xcrun', ['stapler', 'validate', dmgPath]);
    return true;
  } catch {
    return false;
  }
}

async function buildTauriEnv() {
  if (process.platform !== 'darwin') {
    return { ...process.env };
  }

  const env = { ...process.env };
  const identities = await getCodeSigningIdentities();
  const developerIds = identities.filter((identity) => identity.startsWith('Developer ID Application:'));
  if (developerIds.length === 0) {
    return env;
  }

  const selectedIdentity = normalizeIdentityValue(env.APPLE_SIGNING_IDENTITY)
    || developerIds[0];
  env.APPLE_SIGNING_IDENTITY = selectedIdentity;

  const inferredTeamId = extractTeamId(selectedIdentity);
  if (inferredTeamId) {
    if (!env.APPLE_TEAM_ID) {
      env.APPLE_TEAM_ID = inferredTeamId;
      console.log(`[tauri-build] Using inferred APPLE_TEAM_ID=${inferredTeamId}`);
    } else if (env.APPLE_TEAM_ID !== inferredTeamId) {
      console.log(
        `[tauri-build] APPLE_TEAM_ID (${env.APPLE_TEAM_ID}) did not match signing identity team (${inferredTeamId}); using ${inferredTeamId}.`,
      );
      env.APPLE_TEAM_ID = inferredTeamId;
    }
  }

  if (!process.env.APPLE_SIGNING_IDENTITY) {
    console.log(`[tauri-build] Using Developer ID signing identity: ${selectedIdentity}`);
  }

  return env;
}

async function getCodeSigningIdentities() {
  try {
    const { stdout } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning']);
    return stdout
      .split('\n')
      .map((line) => {
        const match = line.match(/"([^"]+)"/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeIdentityValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

function extractTeamId(identity) {
  const match = String(identity ?? '').match(/\(([A-Z0-9]{10})\)$/);
  return match ? match[1] : '';
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

