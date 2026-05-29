#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const strict = process.argv.includes('--strict');

async function main() {
  const identities = await getCodeSigningIdentities();
  const developerIdIdentity = identities.find((name) => name.startsWith('Developer ID Application:'));
  const appleDevelopmentIdentity = identities.find((name) => name.startsWith('Apple Development:'));

  const inferredTeamId = extractTeamId(developerIdIdentity) || extractTeamId(appleDevelopmentIdentity) || '';
  const envSigningIdentity = process.env.APPLE_SIGNING_IDENTITY || developerIdIdentity || '';
  const envTeamId = process.env.APPLE_TEAM_ID || inferredTeamId;

  const checks = [
    {
      label: 'Developer ID Application certificate in keychain',
      ok: Boolean(developerIdIdentity),
      help: 'Install a Developer ID Application certificate in Keychain Access.'
    },
    {
      label: 'APPLE_SIGNING_IDENTITY',
      ok: Boolean(envSigningIdentity),
      help: 'Set APPLE_SIGNING_IDENTITY to your Developer ID Application identity name.'
    },
    {
      label: 'APPLE_ID',
      ok: Boolean(process.env.APPLE_ID),
      help: 'Set APPLE_ID to the Apple account email used for notarization.'
    },
    {
      label: 'APPLE_PASSWORD',
      ok: Boolean(process.env.APPLE_PASSWORD),
      help: 'Set APPLE_PASSWORD to an app-specific password for the Apple account.'
    },
    {
      label: 'APPLE_TEAM_ID',
      ok: Boolean(envTeamId),
      help: 'Set APPLE_TEAM_ID to your 10-character Apple Developer Team ID.'
    }
  ];

  console.log('[macos-preflight] macOS release readiness');
  for (const check of checks) {
    const prefix = check.ok ? 'OK' : 'MISSING';
    console.log(`[${prefix}] ${check.label}`);
    if (!check.ok) {
      console.log(`  -> ${check.help}`);
    }
  }

  if (developerIdIdentity) {
    console.log(`\n[macos-preflight] Detected Developer ID identity:`);
    console.log(`  ${developerIdIdentity}`);
  } else if (appleDevelopmentIdentity) {
    console.log(`\n[macos-preflight] Detected Apple Development identity only:`);
    console.log(`  ${appleDevelopmentIdentity}`);
    console.log('  This is not enough for public distribution builds.');
  }

  if (inferredTeamId) {
    console.log(`\n[macos-preflight] Inferred Team ID: ${inferredTeamId}`);
  }

  console.log('\n[macos-preflight] Suggested exports for this shell:');
  console.log(`export APPLE_SIGNING_IDENTITY="${envSigningIdentity || '<Developer ID Application: ...>'}"`);
  console.log(`export APPLE_ID="${process.env.APPLE_ID || '<your-apple-id-email>'}"`);
  console.log('export APPLE_PASSWORD="<app-specific-password>"');
  console.log(`export APPLE_TEAM_ID="${envTeamId || '<TEAMID10>'}"`);

  const hasMissing = checks.some((check) => !check.ok);
  if (strict && hasMissing) {
    process.exitCode = 1;
  }
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

function extractTeamId(identity) {
  if (!identity) {
    return '';
  }
  const match = identity.match(/\(([A-Z0-9]{10})\)$/);
  return match ? match[1] : '';
}

main().catch((error) => {
  console.error(`[macos-preflight] ${error.message}`);
  process.exitCode = 1;
});

