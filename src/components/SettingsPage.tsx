import React, { useState, useEffect } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Divider,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
} from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import CloudIcon from '@mui/icons-material/Cloud'
import InfoIcon from '@mui/icons-material/Info'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { runDropithCli } from '../lib/cliService'

interface ConfigState {
  dbPath?: string
  syncRootFolder?: string
  effectiveSyncRootFolder?: string
  resolvedSyncRootFolder?: string
  loaded: boolean
  error?: string
}

interface CliStatus {
  detail?: string
  ok: boolean
  error?: string
  checked: boolean
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:\//

function normalizeSyncRootInput(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed) return ''
  if (trimmed === '/') return '/'
  return trimmed.replace(/\/+$/, '')
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return true
  }
  return false
}

function getSyncRootValidationError(value: string): string | null {
  const normalized = normalizeSyncRootInput(value)
  if (!normalized) return 'Sync root folder path is required (example: /Dropith).'
  if (hasControlCharacters(normalized)) return 'Path cannot contain control characters.'
  if (normalized === '/') return 'Root folder cannot be "/". Use a dedicated folder like /Dropith.'
  const isAbsoluteUnix = normalized.startsWith('/')
  const isHomeRelative = normalized === '~' || normalized.startsWith('~/')
  const isAbsoluteWindows = WINDOWS_ABSOLUTE_PATH.test(normalized)
  if (!isAbsoluteUnix && !isHomeRelative && !isAbsoluteWindows) {
    return 'Use an absolute path such as /Dropith, ~/Dropith, or C:/Dropith.'
  }
  return null
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigState>({ loaded: false })
  const [cliStatus, setCliStatus] = useState<CliStatus>({ ok: false, checked: false })
  const [syncRoot, setSyncRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Load current config and CLI status ────────────────────────────────────
  useEffect(() => {
    const checkCli = async () => {
      try {
        // `--version` is not supported by this CLI; use `help` as a reachability probe.
        const res = await runDropithCli(['help'])
        if (res.exitCode === 0) {
          setCliStatus({
            ok: true,
            detail: 'CLI responded to `help`',
            checked: true,
          })
        } else {
          setCliStatus({ ok: false, error: res.stderr || 'CLI returned non-zero exit', checked: true })
        }
      } catch (e) {
        setCliStatus({ ok: false, error: String(e), checked: true })
      }
    }

    const loadConfig = async () => {
      try {
        const res = await runDropithCli(['settings', 'show'])
        if (res.exitCode === 0) {
          const parsed = JSON.parse(res.stdout)
          setConfig({
            dbPath: parsed?.dbPath,
            syncRootFolder: parsed?.sync?.rootFolder ?? parsed?.dropbox?.rootFolder,
            effectiveSyncRootFolder: parsed?.sync?.effectiveRootFolder ?? parsed?.sync?.rootFolder ?? parsed?.dropbox?.rootFolder,
            resolvedSyncRootFolder: parsed?.sync?.resolvedRootFolder,
            loaded: true,
          })
          setSyncRoot(parsed?.sync?.effectiveRootFolder ?? parsed?.sync?.rootFolder ?? parsed?.dropbox?.rootFolder ?? '')
        } else {
          setConfig({ loaded: true, error: 'Could not load config — using defaults' })
        }
      } catch {
        setConfig({ loaded: true, error: 'CLI settings command not available' })
      }
    }

    checkCli()
    loadConfig()
  }, [])

  const handleSaveSyncRoot = async () => {
    const inputError = getSyncRootValidationError(syncRoot)
    if (inputError) {
      setSaveResult({ ok: false, msg: inputError })
      return
    }
    const normalizedRoot = normalizeSyncRootInput(syncRoot)
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await runDropithCli(['settings', 'set', 'root-folder', normalizedRoot])
      if (res.exitCode === 0) {
        const parsed = JSON.parse(res.stdout)
        setSaveResult({ ok: true, msg: 'Sync root folder saved.' })
        setConfig((c) => ({
          ...c,
          syncRootFolder: parsed?.sync?.rootFolder ?? normalizedRoot,
          effectiveSyncRootFolder: parsed?.sync?.effectiveRootFolder ?? normalizedRoot,
          resolvedSyncRootFolder: parsed?.sync?.resolvedRootFolder ?? c.resolvedSyncRootFolder,
        }))
        setSyncRoot(parsed?.sync?.effectiveRootFolder ?? normalizedRoot)
      } else {
        setSaveResult({ ok: false, msg: res.stderr || 'Save failed' })
      }
    } catch (e) {
      setSaveResult({ ok: false, msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const syncRootValidationError = getSyncRootValidationError(syncRoot)
  const normalizedSyncRootPreview = normalizeSyncRootInput(syncRoot)

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5, pb: 4 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <SettingsIcon sx={{ color: '#1a8ab5', fontSize: 28 }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Settings
          </Typography>
          <Typography variant="caption" sx={{ color: '#7dbad6' }}>
            PuzzlePKM configuration &amp; diagnostics
          </Typography>
        </Box>
      </Stack>

      {/* ── CLI Status ─────────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, bgcolor: '#0e2038', border: '1px solid #1c3558' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <InfoIcon sx={{ fontSize: 16, color: '#1a8ab5' }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#7dbad6',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '10px',
            }}
          >
            CLI Status
          </Typography>
        </Stack>

        {!cliStatus.checked ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={14} />
            <Typography variant="body2" sx={{ color: '#7dbad6' }}>
              Checking CLI…
            </Typography>
          </Stack>
        ) : (
          <List dense disablePadding>
            <ListItem disablePadding sx={{ py: 0.5 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    {cliStatus.ok ? (
                      <CheckCircleIcon sx={{ fontSize: 15, color: '#48b278' }} />
                    ) : (
                      <ErrorIcon sx={{ fontSize: 15, color: '#e05a5a' }} />
                    )}
                    <Typography component="div" variant="body2">
                      CLI reachable:{' '}
                      <Chip
                        label={cliStatus.ok ? 'OK' : 'Error'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '10px',
                          bgcolor: cliStatus.ok
                            ? 'rgba(72,178,120,0.2)'
                            : 'rgba(224,90,90,0.2)',
                          border: `1px solid ${cliStatus.ok ? 'rgba(72,178,120,0.5)' : 'rgba(224,90,90,0.5)'}`,
                          color: cliStatus.ok ? '#7dcfaa' : '#e8a0a0',
                        }}
                      />
                    </Typography>
                  </Stack>
                }
              />
            </ListItem>
            {cliStatus.detail && (
              <ListItem disablePadding sx={{ py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ color: '#b0cce0' }}>
                      {cliStatus.detail}
                    </Typography>
                  }
                />
              </ListItem>
            )}
            {cliStatus.error && (
              <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: '12px' }}>
                {cliStatus.error}
              </Alert>
            )}
          </List>
        )}
      </Paper>

      {/* ── Storage ────────────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, bgcolor: '#0e2038', border: '1px solid #1c3558' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <StorageIcon sx={{ fontSize: 16, color: '#1a8ab5' }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#7dbad6',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '10px',
            }}
          >
            Local Storage
          </Typography>
        </Stack>

        {!config.loaded ? (
          <CircularProgress size={16} />
        ) : (
          <List dense disablePadding>
            <ListItem disablePadding sx={{ py: 0.5 }}>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ color: '#b0cce0' }}>
                    Database path
                  </Typography>
                }
                secondary={
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'monospace',
                      color: '#e4f0fb',
                      wordBreak: 'break-all',
                    }}
                  >
                    {config.dbPath || '(platform default; legacy dropith app-data folder)'}
                  </Typography>
                }
              />
            </ListItem>
            <ListItem disablePadding sx={{ py: 0.5 }}>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ color: '#b0cce0' }}>
                    Sync root folder
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" sx={{ color: '#e4f0fb', wordBreak: 'break-all' }}>
                    {config.syncRootFolder || '(not configured)'}
                  </Typography>
                }
              />
            </ListItem>
          </List>
        )}
        {config.error && (
          <Alert severity="warning" sx={{ mt: 1, py: 0.5, fontSize: '12px' }}>
            {config.error}
          </Alert>
        )}
      </Paper>

      {/* ── Sync ───────────────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, bgcolor: '#0e2038', border: '1px solid #1c3558' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <CloudIcon sx={{ fontSize: 16, color: '#1a8ab5' }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#7dbad6',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '10px',
            }}
          >
            Local Sync
          </Typography>
        </Stack>

        <Typography component="div" variant="body2" sx={{ color: '#b0cce0', mb: 2 }}>
          Projects and Reference Materials are discovered under your configured sync folder.
          Set the root folder path below. The legacy <code>/Dropith</code> virtual root remains supported
          for compatibility.
        </Typography>

        <Stack spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Sync root folder"
            value={syncRoot}
            onChange={(e) => setSyncRoot(e.target.value)}
            placeholder="/Dropith"
            helperText={syncRootValidationError || 'Folder path used by sync (legacy default /Dropith remains supported)'}
            error={Boolean(syncRootValidationError)}
            variant="outlined"
          />

          {!syncRootValidationError && normalizedSyncRootPreview && (
            <Typography variant="caption" sx={{ color: '#7dbad6', wordBreak: 'break-all' }}>
              Effective sync root: <Box component="span" sx={{ color: '#e4f0fb', fontFamily: 'monospace' }}>{normalizedSyncRootPreview}</Box>
            </Typography>
          )}

          {config.resolvedSyncRootFolder && (
            <Typography variant="caption" sx={{ color: '#7dbad6', wordBreak: 'break-all' }}>
              Resolved local folder: <Box component="span" sx={{ color: '#e4f0fb', fontFamily: 'monospace' }}>{config.resolvedSyncRootFolder}</Box>
            </Typography>
          )}

          {saveResult && (
            <Alert severity={saveResult.ok ? 'success' : 'error'} sx={{ py: 0.5, fontSize: '12px' }}>
              {saveResult.msg}
            </Alert>
          )}

          <Button
            variant="contained"
            size="small"
            disabled={saving || Boolean(syncRootValidationError)}
            onClick={handleSaveSyncRoot}
            sx={{ alignSelf: 'flex-start' }}
          >
            {saving ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Save path
          </Button>
        </Stack>

        <Divider sx={{ borderColor: '#1c3558', my: 2 }} />

        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: '#7dbad6',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '10px',
            display: 'block',
            mb: 1,
          }}
        >
          Expected folder structure
        </Typography>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.5,
            bgcolor: 'rgba(0,0,0,0.3)',
            borderRadius: 1,
            border: '1px solid #1c3558',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#7dbad6',
            overflow: 'auto',
          }}
        >
          {`<sync-root>/
└── ...
    ├── projects/      ← each sub-folder = one Project
    ├── ref-materials/ ← each sub-folder = one Ref Material
    ├── daily-notes/
    ├── topic-notes/
    └── habits/`}
        </Box>
        <Typography variant="caption" sx={{ color: '#4a6a8a', display: 'block', mt: 1 }}>
          New projects and reference materials are added by creating folders in the sync root, not through
          the app.
        </Typography>
      </Paper>

      {/* ── About ──────────────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, bgcolor: '#0e2038', border: '1px solid #1c3558' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <InfoIcon sx={{ fontSize: 16, color: '#1a8ab5' }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#7dbad6',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '10px',
            }}
          >
            About PuzzlePKM
          </Typography>
        </Stack>
        <List dense disablePadding>
          {[
            ['App', 'PuzzlePKM Desktop'],
            ['Architecture', 'CLI-first · Tauri wrapper · React UI'],
            ['Storage', 'Local SQLite via node:sqlite'],
            ['Sync', 'Local folder'],
            ['Compatibility', 'dropith CLI/data paths still supported'],
          ].map(([label, value]) => (
            <ListItem key={label} disablePadding sx={{ py: 0.4 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1}>
                    <Typography variant="body2" sx={{ color: '#7dbad6', minWidth: 110 }}>
                      {label}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e4f0fb' }}>
                      {value}
                    </Typography>
                  </Stack>
                }
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  )
}
