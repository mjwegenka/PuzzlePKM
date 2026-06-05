#!/usr/bin/env node

import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';

await main();

async function main() {
  const env = { ...process.env };
  await ensureReleaseEnv(env);
  await ensureNotaryCredentials(env);
  await run('node', ['./scripts/macos_release_preflight.mjs', '--strict'], env);
  await run('npm', ['run', 'tauri:build'], env);
  const publishCode = await run('node', ['./scripts/publish_macos_release_asset.mjs'], env, { allowFailure: true });
  if (publishCode === 0) return;
  if (publishCode === 2) {
    console.log('[tauri-build:publish] GitHub token was rejected. Please enter a new token.');
    env.GITHUB_TOKEN = await promptForValue('GitHub token (repo access)', { secret: true });
    await run('node', ['./scripts/publish_macos_release_asset.mjs'], env);
    return;
  }
  throw new Error(`node ./scripts/publish_macos_release_asset.mjs exited with code ${publishCode}`);
}

async function ensureNotaryCredentials(env) {
  if (!String(env.APPLE_TEAM_ID ?? '').trim()) {
    return;
  }
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const check = await runCapture(
      'xcrun',
      [
        'notarytool',
        'history',
        '--apple-id',
        env.APPLE_ID,
        '--password',
        env.APPLE_PASSWORD,
        '--team-id',
        env.APPLE_TEAM_ID || '',
      ],
      env,
    );
    if (check.code === 0) {
      return;
    }
    if (!isAppleAuthFailure(check.combinedOutput)) {
      return;
    }
    if (attempt >= maxAttempts) {
      break;
    }
    console.log('[tauri-build:publish] Apple notarization credentials were rejected. Please re-enter.');
    env.APPLE_ID = await promptForValue('Apple ID email');
    env.APPLE_PASSWORD = await promptForValue('Apple app-specific password', { secret: true });
  }
}

async function ensureReleaseEnv(env) {
  const required = [
    { key: 'APPLE_ID', label: 'Apple ID email' },
    { key: 'APPLE_PASSWORD', label: 'Apple app-specific password', secret: true },
    { key: 'GITHUB_TOKEN', label: 'GitHub token (repo access)', secret: true },
  ];

  for (const item of required) {
    if (String(env[item.key] ?? '').trim()) continue;
    env[item.key] = await promptForValue(item.label, { secret: Boolean(item.secret) });
  }
}

async function promptForValue(label, options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Missing required environment variable and no interactive terminal available: ${label}`);
  }

  const secret = Boolean(options.secret);
  if (!secret) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const value = (await rl.question(`${label}: `)).trim();
      if (!value) throw new Error(`${label} cannot be empty.`);
      return value;
    } finally {
      rl.close();
    }
  }

  return promptSecret(`${label}: `);
}

function promptSecret(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.removeListener('data', onData);
      try {
        stdin.setRawMode(Boolean(wasRaw));
      } catch {
        // ignore
      }
      stdin.pause();
    };

    const finish = () => {
      stdout.write('\n');
      cleanup();
      const trimmed = value.trim();
      if (!trimmed) {
        reject(new Error(`${question.replace(/:\s*$/, '')} cannot be empty.`));
      } else {
        resolve(trimmed);
      }
    };

    const onData = (chunk) => {
      const char = String(chunk);
      if (char === '\u0003') {
        cleanup();
        reject(new Error('Prompt cancelled.'));
        return;
      }
      if (char === '\r' || char === '\n') {
        finish();
        return;
      }
      if (char === '\u007f') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }
      value += char;
      stdout.write('*');
    };

    stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

function run(command, args, env = process.env, options = {}) {
  const allowFailure = Boolean(options.allowFailure);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        if (allowFailure) {
          resolve(code);
          return;
        }
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        return;
      }
      resolve(0);
    });
  });
}

function runCapture(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr, combinedOutput: `${stdout}\n${stderr}` });
    });
  });
}

function isAppleAuthFailure(text) {
  const normalized = String(text ?? '').toLowerCase();
  return normalized.includes('invalid credentials')
    || normalized.includes('http status code: 401')
    || normalized.includes('username or password is incorrect');
}
