#!/usr/bin/env node

import { stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RELEASE_TAG = 'desktop-latest';
const RELEASE_NAME = 'PuzzlePKM Desktop Latest';
const ASSET_NAME = 'PuzzlePKM-macos.dmg';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = process.env.GITHUB_TOKEN;

  const { owner, repo } = await getRepoCoordinates();
  const dmgPath = await findLatestDmg();
  const directUrl = `https://github.com/${owner}/${repo}/releases/download/${RELEASE_TAG}/${ASSET_NAME}`;

  if (!token) {
    console.log('[publish-macos] Skipping upload because GITHUB_TOKEN is not set.');
    console.log(`[publish-macos] Expected direct download URL: ${directUrl}`);
    return;
  }

  if (dryRun) {
    console.log(`[publish-macos] Dry run: would upload ${dmgPath} as ${ASSET_NAME}`);
    console.log(`[publish-macos] Direct download URL: ${directUrl}`);
    return;
  }

  await verifyMacOSBundleSecurity();

  const release = await upsertRelease({ owner, repo, token });
  await deleteAssetIfPresent({ owner, repo, token, releaseId: release.id, assetName: ASSET_NAME });
  await uploadAsset({ owner, repo, token, uploadUrl: release.upload_url, filePath: dmgPath, assetName: ASSET_NAME });

  console.log(`[publish-macos] Uploaded ${ASSET_NAME}`);
  console.log(`[publish-macos] Direct download URL: ${directUrl}`);
}

async function verifyMacOSBundleSecurity() {
  // Guardrail: never publish an unsigned/unnotarized build as the public download artifact.
  await execFileAsync('node', ['./scripts/verify_macos_bundle.mjs']);
}

async function getRepoCoordinates() {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
  const url = stdout.trim();

  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(`Unsupported origin URL format: ${url}`);
}

async function findLatestDmg() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = dirname(currentDir);
  const dmgDir = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'dmg');

  if (!existsSync(dmgDir)) {
    throw new Error(`DMG directory not found: ${dmgDir}. Run npm run tauri:build first.`);
  }

  const { stdout } = await execFileAsync('zsh', ['-lc', `ls -t "${dmgDir}"/*.dmg 2>/dev/null | head -n 1`]);
  const filePath = stdout.trim();

  if (!filePath) {
    throw new Error(`No .dmg file found in ${dmgDir}. Run npm run tauri:build first.`);
  }

  return filePath;
}

async function upsertRelease({ owner, repo, token }) {
  const releaseResp = await githubRequest({
    token,
    method: 'GET',
    url: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${RELEASE_TAG}`
  });

  if (releaseResp.ok) {
    return releaseResp.json;
  }

  if (releaseResp.status !== 404) {
    throw new Error(`Failed to load release ${RELEASE_TAG}: ${releaseResp.status} ${releaseResp.text}`);
  }

  const createResp = await githubRequest({
    token,
    method: 'POST',
    url: `https://api.github.com/repos/${owner}/${repo}/releases`,
    body: {
      tag_name: RELEASE_TAG,
      name: RELEASE_NAME,
      draft: false,
      prerelease: false,
      make_latest: 'true'
    }
  });

  if (!createResp.ok) {
    throw new Error(`Failed to create release ${RELEASE_TAG}: ${createResp.status} ${createResp.text}`);
  }

  return createResp.json;
}

async function deleteAssetIfPresent({ owner, repo, token, releaseId, assetName }) {
  const assetsResp = await githubRequest({
    token,
    method: 'GET',
    url: `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets`
  });

  if (!assetsResp.ok) {
    throw new Error(`Failed to list release assets: ${assetsResp.status} ${assetsResp.text}`);
  }

  const existing = assetsResp.json.find((asset) => asset.name === assetName);
  if (!existing) {
    return;
  }

  const deleteResp = await githubRequest({
    token,
    method: 'DELETE',
    url: `https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`
  });

  if (!deleteResp.ok) {
    throw new Error(`Failed to delete existing asset ${assetName}: ${deleteResp.status} ${deleteResp.text}`);
  }
}

async function uploadAsset({ owner, repo, token, uploadUrl, filePath, assetName }) {
  const fileBuffer = await readFile(filePath);
  await stat(filePath);

  const normalizedUploadUrl = uploadUrl.replace('{?name,label}', '');
  const url = `${normalizedUploadUrl}?name=${encodeURIComponent(assetName)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'puzzlepkm-release-uploader',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: fileBuffer
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload ${assetName} to ${owner}/${repo}: ${response.status} ${text}`);
  }
}

async function githubRequest({ token, method, url, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'puzzlepkm-release-uploader',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json
  };
}

main().catch((error) => {
  console.error(`[publish-macos] ${error.message}`);
  process.exitCode = 1;
});

