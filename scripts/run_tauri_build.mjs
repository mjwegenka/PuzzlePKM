#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

await main();

async function main() {
  await run('npm', ['run', 'version:sync']);

  const env = await buildTauriEnv();
  await run('tauri', ['build'], env);
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

