#!/usr/bin/env node
/**
 * Packs mcpb/ into dist/puzzlepkm.mcpb (a zip archive) for installation into
 * Claude Desktop. Keeps the manifest version in step with package.json and
 * copies the app icon in so the bundle has no checked-in binary duplicates.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(repoRoot, 'mcpb');
const manifestPath = join(bundleDir, 'manifest.json');
const iconSource = join(repoRoot, 'public', 'icons', 'icon-128.png');
const iconTarget = join(bundleDir, 'icon.png');
const distDir = join(repoRoot, 'dist');
const outputPath = join(distDir, 'puzzlepkm.mcpb');

function fail(message) {
  console.error(`[build-mcpb] ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) fail(`Missing ${manifestPath}.`);
if (!existsSync(iconSource)) fail(`Missing icon at ${iconSource}.`);

const packageVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== packageVersion) {
  manifest.version = packageVersion;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[build-mcpb] Synced manifest version to ${packageVersion}.`);
}

copyFileSync(iconSource, iconTarget);
mkdirSync(distDir, { recursive: true });
rmSync(outputPath, { force: true });

// zip ships with macOS and every mainstream Linux distro; using it avoids
// adding an archiving dependency for a build step that runs once per release.
// It is staged through the temp directory because zip writes to a scratch file
// and renames it into place, which fails on some synced or mounted volumes.
const stagedPath = join(tmpdir(), `puzzlepkm-${process.pid}.mcpb`);
rmSync(stagedPath, { force: true });

const result = spawnSync('zip', ['-r', '-q', '-X', stagedPath, 'manifest.json', 'icon.png', 'server'], {
  cwd: bundleDir,
  stdio: 'inherit',
});

if (result.error) fail(`Could not run zip: ${result.error.message}`);
if (result.status !== 0) fail(`zip exited with status ${result.status}.`);

copyFileSync(stagedPath, outputPath);
rmSync(stagedPath, { force: true });

console.log(`[build-mcpb] Wrote ${outputPath} (version ${manifest.version}).`);
console.log('[build-mcpb] Install it by double-clicking the file, then set the PuzzlePKM folder and Node path in its settings.');
