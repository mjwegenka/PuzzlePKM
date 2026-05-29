#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isCheckOnly = process.argv.includes('--check');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

const packageJsonPath = join(repoRoot, 'package.json');
const tauriConfigPath = join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = join(repoRoot, 'src-tauri', 'Cargo.toml');

await main();

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const packageVersion = packageJson.version;

  assertSemver(packageVersion);

  const tauriRaw = await readFile(tauriConfigPath, 'utf8');
  const cargoRaw = await readFile(cargoTomlPath, 'utf8');

  const tauriJson = JSON.parse(tauriRaw);
  const tauriCurrentVersion = tauriJson.version;
  const cargoCurrentVersion = readCargoPackageVersion(cargoRaw);

  const mismatches = [];
  if (tauriCurrentVersion !== packageVersion) {
    mismatches.push(`src-tauri/tauri.conf.json (${tauriCurrentVersion} != ${packageVersion})`);
  }
  if (cargoCurrentVersion !== packageVersion) {
    mismatches.push(`src-tauri/Cargo.toml (${cargoCurrentVersion} != ${packageVersion})`);
  }

  if (isCheckOnly) {
    if (mismatches.length > 0) {
      console.error('[version-sync] Version mismatch found:');
      for (const mismatch of mismatches) {
        console.error(`- ${mismatch}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`[version-sync] OK: all versions match ${packageVersion}`);
    return;
  }

  tauriJson.version = packageVersion;
  const updatedTauri = `${JSON.stringify(tauriJson, null, 2)}\n`;

  const updatedCargo = cargoRaw.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+("\s*\n)/,
    `$1${packageVersion}$2`
  );

  if (updatedCargo === cargoRaw) {
    throw new Error('Could not update [package] version in src-tauri/Cargo.toml');
  }

  await writeFile(tauriConfigPath, updatedTauri, 'utf8');
  await writeFile(cargoTomlPath, updatedCargo, 'utf8');

  if (mismatches.length === 0) {
    console.log(`[version-sync] No changes needed; all versions already match ${packageVersion}`);
    return;
  }

  console.log(`[version-sync] Synced versions to ${packageVersion}`);
  console.log('- Updated src-tauri/tauri.conf.json');
  console.log('- Updated src-tauri/Cargo.toml');
}

function readCargoPackageVersion(cargoRaw) {
  const match = cargoRaw.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('Could not locate [package] version in src-tauri/Cargo.toml');
  }
  return match[1];
}

function assertSemver(version) {
  // Accept semver core + optional prerelease/build metadata.
  const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semverPattern.test(version)) {
    throw new Error(
      `[version-sync] package.json version must use semver (x.y.z). Received: ${version}`
    );
  }
}

