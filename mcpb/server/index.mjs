#!/usr/bin/env node
/**
 * Claude Desktop extension launcher for the PuzzlePKM MCP server.
 *
 * This bundle stays deliberately thin: it delegates to the working copy of the
 * repository rather than embedding one. The server reads a SQLite database at a
 * machine-specific path through the same repository layer the CLI uses, so a
 * vendored copy would drift from the app it reads. Delegating means repository
 * changes take effect on the next restart with no repacking.
 */
import process from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOG_PREFIX = '[puzzlepkm-mcpb]';

function fail(message) {
  process.stderr.write(`${LOG_PREFIX} ${message}\n`);
  process.exit(1);
}

// Optional user_config fields are substituted as empty strings when left blank.
// app.mjs resolves paths with `??`, which treats '' as a real value, so an empty
// override would point the server at a nonexistent database. Strip them first.
for (const name of ['PUZZLEPKM_DB_PATH', 'PUZZLEPKM_SECRETS_PATH']) {
  if (String(process.env[name] ?? '').trim() === '') delete process.env[name];
}

const repoPath = String(process.env.PUZZLEPKM_REPO_PATH || '').trim();

if (!repoPath) {
  fail('PUZZLEPKM_REPO_PATH is not set. Open the extension settings in Claude and set the PuzzlePKM folder.');
}

/**
 * The configured path may be either a source checkout or an installed
 * PuzzlePKM.app. tauri.conf.json bundles cli.mjs and cli/ as app resources, so
 * the packaged app carries the same server code — Tauri just nests it under
 * _up_/ because the resource paths escape src-tauri/. These candidates mirror
 * resolve_cli_path() in src-tauri, and also accept a path pointing straight at
 * Contents/Resources.
 */
const candidateRoots = [
  repoPath,
  join(repoPath, 'Contents', 'Resources', '_up_'),
  join(repoPath, 'Contents', 'Resources'),
  join(repoPath, '_up_'),
];

const entryPoint = candidateRoots
  .map((root) => join(root, 'cli', 'mcp', 'server.mjs'))
  .find((candidate) => existsSync(candidate));

if (!entryPoint) {
  fail([
    'Could not find the PuzzlePKM MCP server. Looked for cli/mcp/server.mjs under:',
    ...candidateRoots.map((root) => `  - ${root}`),
    'Set the PuzzlePKM folder in the extension settings to either your source checkout (the folder containing cli.mjs) or the installed PuzzlePKM.app.',
    'If you pointed at an installed app, it must have been built from a version that includes the MCP server.',
  ].join('\n'));
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  fail(`Node ${process.versions.node} is too old. PuzzlePKM needs Node 22 or newer for its built-in node:sqlite support. Set the Node executable in the extension settings to an absolute path such as ~/.nvm/versions/node/v22.14.0/bin/node.`);
}

const { startServer } = await import(pathToFileURL(entryPoint).href);

startServer().catch((error) => {
  process.stderr.write(`${LOG_PREFIX} ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
