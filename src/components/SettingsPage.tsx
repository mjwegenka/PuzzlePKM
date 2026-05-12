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
  dropboxRootFolder?: string
  dropboxConnected?: boolean
  dropboxAccountEmail?: string
  loaded: boolean
  error?: string
}

interface CliStatus {
  detail?: string
  ok: boolean
  error?: string
  checked: boolean
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigState>({ loaded: false })
  const [cliStatus, setCliStatus] = useState<CliStatus>({ ok: false, checked: false })
  const [dropboxRoot, setDropboxRoot] = useState('')
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
            dropboxRootFolder: parsed?.dropbox?.rootFolder,
            dropboxConnected: Boolean(parsed?.dropbox?.isConnected),
            dropboxAccountEmail: parsed?.dropbox?.accountEmail,
            loaded: true,
          })
          setDropboxRoot(parsed?.dropbox?.rootFolder ?? '')
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

  const handleSaveDropbox = async () => {
    if (!dropboxRoot.trim()) return
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await runDropithCli(['settings', 'set', 'root-folder', dropboxRoot.trim()])
      if (res.exitCode === 0) {
        setSaveResult({ ok: true, msg: 'Dropbox root folder saved.' })
        setConfig((c) => ({ ...c, dropboxRootFolder: dropboxRoot.trim() }))
      } else {
        setSaveResult({ ok: false, msg: res.stderr || 'Save failed' })
      }
    } catch (e) {
      setSaveResult({ ok: false, msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

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
            Dropith configuration &amp; diagnostics
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
                    <Typography variant="body2">
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
                    {config.dbPath || '~/.dropith/dropith.db (default)'}
                  </Typography>
                }
              />
            </ListItem>
            <ListItem disablePadding sx={{ py: 0.5 }}>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ color: '#b0cce0' }}>
                    Dropbox connection
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" sx={{ color: '#e4f0fb' }}>
                    {config.dropboxConnected
                      ? `Connected${config.dropboxAccountEmail ? ` (${config.dropboxAccountEmail})` : ''}`
                      : 'Not connected'}
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

      {/* ── Dropbox ────────────────────────────────────────────────────────── */}
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
            Dropbox Integration
          </Typography>
        </Stack>

        <Typography variant="body2" sx={{ color: '#b0cce0', mb: 2 }}>
          Projects and Reference Materials are discovered under your configured Dropbox app folder.
          Set the Dropbox root folder path below.
        </Typography>

        <Stack spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Dropbox root folder"
            value={dropboxRoot}
            onChange={(e) => setDropboxRoot(e.target.value)}
            placeholder="/Dropith"
            helperText="Dropbox app folder path used by sync (for example /Dropith)"
            variant="outlined"
          />

          {saveResult && (
            <Alert severity={saveResult.ok ? 'success' : 'error'} sx={{ py: 0.5, fontSize: '12px' }}>
              {saveResult.msg}
            </Alert>
          )}

          <Button
            variant="contained"
            size="small"
            disabled={saving || !dropboxRoot.trim()}
            onClick={handleSaveDropbox}
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
          {`~/Dropbox/
└── Dropith/
    ├── projects/      ← each sub-folder = one Project
    ├── ref-materials/ ← each sub-folder = one Ref Material
    ├── daily-notes/
    ├── topic-notes/
    └── habits/`}
        </Box>
        <Typography variant="caption" sx={{ color: '#4a6a8a', display: 'block', mt: 1 }}>
          New projects and reference materials are added by creating folders in Dropbox, not through
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
            About Dropith
          </Typography>
        </Stack>
        <List dense disablePadding>
          {[
            ['App', 'Dropith Desktop'],
            ['Architecture', 'CLI-first · Tauri wrapper · React UI'],
            ['Storage', 'Local SQLite via node:sqlite'],
            ['Sync', 'Dropbox (folder-based)'],
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

