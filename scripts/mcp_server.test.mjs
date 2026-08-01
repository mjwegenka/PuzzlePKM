// Smoke test for the MCP server: protocol handshake, tool discovery, a read
// against a scratch database, the write gate, and a gated write.
//
// The server is spawned as a child process rather than imported so the test
// exercises the real stdio transport — the failure mode that matters most is
// stray stdout output corrupting the JSON-RPC stream, and only a subprocess
// can catch it.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(repoRoot, 'cli', 'mcp', 'server.mjs');
const cliPath = join(repoRoot, 'cli.mjs');

function scratchEnv(allowWrites) {
  const dir = mkdtempSync(join(tmpdir(), 'puzzlepkm-mcp-'));
  return {
    dir,
    env: {
      ...process.env,
      PUZZLEPKM_DB_PATH: join(dir, 'puzzlepkm.sqlite'),
      PUZZLEPKM_SECRETS_PATH: join(dir, 'secrets.json'),
      PUZZLEPKM_MCP_ALLOW_WRITES: allowWrites ? 'true' : 'false',
    },
  };
}

function startClient(env) {
  const child = spawn(process.execPath, ['--no-warnings', serverPath], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  const stdoutLines = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    stdoutLines.push(line);
    const message = JSON.parse(line);
    const resolve_ = pending.get(message.id);
    if (resolve_) {
      pending.delete(message.id);
      resolve_(message);
    }
  });

  let nextId = 1;
  const call = (method, params) => new Promise((resolvePromise, rejectPromise) => {
    const id = nextId++;
    pending.set(id, resolvePromise);
    child.on('error', rejectPromise);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  return {
    call,
    stdoutLines,
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

function toolPayload(response) {
  return JSON.parse(response.result.content[0].text);
}

// Seeds through the CLI so the fixture is built by the same code path a user
// would take, rather than by hand-written SQL that could drift from the schema.
function seed(env, kind, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--no-warnings', cliPath, 'write', kind, JSON.stringify(payload)], { env, stdio: 'ignore' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`seed ${kind} exited ${code}`))));
  });
}

test('read-only server answers the handshake and reports status', async () => {
  const { dir, env } = scratchEnv(false);
  const client = startClient(env);
  try {
    await seed(env, 'topic-note', {
      title: 'Seeded note',
      contentMarkdown: 'A seeded note citing Romans 3:16 for the scripture extractor.',
      tags: ['Testing'],
    });

    const init = await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'puzzlepkm');
    assert.equal(init.result.protocolVersion, '2025-06-18');

    const tools = await client.call('tools/list', {});
    const names = tools.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('search_knowledge_base'));
    assert.ok(names.includes('get_status'));
    assert.ok(names.includes('append_to_daily_note'));

    const status = toolPayload(await client.call('tools/call', { name: 'get_status', arguments: {} }));
    assert.equal(status.writesEnabled, false);
    assert.equal(status.counts['topic-note'], 1);

    const search = toolPayload(await client.call('tools/call', { name: 'search_knowledge_base', arguments: { query: 'seeded' } }));
    assert.ok(search.matchCount > 0);

    // The scripture in the seeded body should have been extracted and linked.
    const scriptures = toolPayload(await client.call('tools/call', { name: 'list_scripture_references', arguments: {} }));
    assert.equal(scriptures.scriptures[0].reference, 'Romans 3:16');
    assert.equal(scriptures.scriptures[0].linkedNotes.length, 1);

    // Every line on stdout must be a complete JSON-RPC message.
    for (const line of client.stdoutLines) assert.doesNotThrow(() => JSON.parse(line));
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write tools refuse when writes are disabled', async () => {
  const { dir, env } = scratchEnv(false);
  const client = startClient(env);
  try {
    await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    const response = await client.call('tools/call', {
      name: 'create_topic_note',
      arguments: { title: 'Should not exist', markdown: 'blocked' },
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /disabled/i);

    const status = toolPayload(await client.call('tools/call', { name: 'get_status', arguments: {} }));
    assert.equal(status.counts['topic-note'], 0);
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enabled writes create notes and append to daily notes without clobbering', async () => {
  const { dir, env } = scratchEnv(true);
  const client = startClient(env);
  try {
    await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

    const created = toolPayload(await client.call('tools/call', {
      name: 'create_topic_note',
      arguments: { title: 'Written by MCP', markdown: 'Body mentioning John 1:1.', tags: ['Testing'] },
    }));
    assert.equal(created.title, 'Written by MCP');
    assert.equal(created.tags[0], 'Testing');
    // Scripture extraction must run for MCP writes exactly as it does in the app.
    assert.equal(created.links.some((link) => link.title === 'John 1:1'), true);

    const first = toolPayload(await client.call('tools/call', { name: 'append_to_daily_note', arguments: { markdown: 'first entry' } }));
    const second = toolPayload(await client.call('tools/call', { name: 'append_to_daily_note', arguments: { markdown: 'second entry' } }));
    assert.equal(second.id, first.id);
    assert.match(second.contentMarkdown, /first entry/);
    assert.match(second.contentMarkdown, /second entry/);

    const habit = toolPayload(await client.call('tools/call', {
      name: 'set_habit',
      arguments: { text: 'Test habit', status: 'accomplished' },
    }));
    assert.equal(habit.action, 'created');
    assert.equal(habit.habit.status, 'accomplished');
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid input is reported as a tool error, not a protocol failure', async () => {
  const { dir, env } = scratchEnv(false);
  const client = startClient(env);
  try {
    await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

    const badDate = await client.call('tools/call', { name: 'get_daily_note', arguments: { date: 'not-a-date' } });
    assert.equal(badDate.result.isError, true);
    assert.match(badDate.result.content[0].text, /YYYY-MM-DD/);

    const badKind = await client.call('tools/call', { name: 'list_objects', arguments: { kind: 'sandwiches' } });
    assert.equal(badKind.result.isError, true);
    assert.match(badKind.result.content[0].text, /Unknown object kind/);

    const unknownTool = await client.call('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.equal(unknownTool.result.isError, true);
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
