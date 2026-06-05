import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const repoDir = '/Users/michael/WebProjects/puzzlepkm'
const importDir = '/Users/michael/Library/CloudStorage/Sync/_Staging/To Import/05_Habit'

function runCli(args) {
  return spawnSync('node', ['./cli.mjs', ...args], {
    cwd: repoDir,
    encoding: 'utf8',
  })
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    out[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

function parseTags(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

const listed = runCli(['list', 'habit'])
if (listed.status !== 0) {
  console.error(listed.stderr || 'Failed to list habits')
  process.exit(1)
}

const existingKeys = new Set()
for (const line of listed.stdout.split('\n').filter(Boolean)) {
  const parts = line.split('\t')
  const date = (parts[1] || '').trim()
  const text = (parts[3] || '').trim().toLowerCase()
  const tags = (parts[5] || '')
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(',')
    .toLowerCase()
  existingKeys.add(`${date}|${text}|${tags}`)
}

const files = fs.readdirSync(importDir)
  .filter((n) => n.toLowerCase().endsWith('.md'))
  .sort((a, b) => a.localeCompare(b))

let imported = 0
let skipped = 0
let failed = 0

for (const name of files) {
  const filePath = path.join(importDir, name)
  const content = fs.readFileSync(filePath, 'utf8')
  const fm = parseFrontmatter(content)

  if (!fm || String(fm.type || '').toLowerCase() !== 'habit') {
    failed += 1
    console.log(`FAILED ${name}: invalid or missing Habit front matter`)
    continue
  }

  const date = String(fm.date || '').trim()
  const text = String(fm.title || '').trim() || path.basename(name, '.md').replace(/\s*\(\d+\)$/, '')
  const tags = parseTags(fm.collections)

  if (!date || !text) {
    failed += 1
    console.log(`FAILED ${name}: missing date/title`)
    continue
  }

  const key = `${date}|${text.toLowerCase()}|${tags.join(',').toLowerCase()}`
  if (existingKeys.has(key)) {
    skipped += 1
    console.log(`SKIP ${name}`)
    continue
  }

  const write = runCli(['write', 'habit', JSON.stringify({ date, text, tags })])
  if (write.status !== 0) {
    failed += 1
    console.log(`FAILED ${name}: ${(write.stderr || 'write failed').trim()}`)
    continue
  }

  existingKeys.add(key)
  imported += 1
  console.log(`IMPORTED ${name}: ${date} / ${text}`)
}

console.log(`Done. Imported=${imported} Skipped=${skipped} Failed=${failed}`)
