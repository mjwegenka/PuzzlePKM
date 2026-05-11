import { useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { useUIStore } from '../store/uiStore'
import { formatDateShort } from '../lib/dateUtils'
import type { DropboxConfigState } from '../shared/types'

const EMPTY_CONFIG: DropboxConfigState = {
  appKeySet: false,
  appSecretSet: false,
  source: 'none',
}

export default function SettingsPage() {
  const { authState, syncStatus, setAuthState, setSyncStatus } = useUIStore()
  const [configState, setConfigState] = useState<DropboxConfigState>(EMPTY_CONFIG)
  const [appKeyInput, setAppKeyInput] = useState('')
  const [appSecretInput, setAppSecretInput] = useState('')
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configMessage, setConfigMessage] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const loadConfig = async () => {
      setConfigLoading(true)
      setConfigError(null)
      const [config, auth] = await Promise.all([
        window.dropith.auth.getConfig(),
        window.dropith.auth.getState(),
      ])
      if (config.success && config.data) {
        setConfigState(config.data)
      } else {
        setConfigError(config.error ?? 'Failed to load Dropbox app credentials')
      }
      if (auth.success && auth.data) {
        setAuthState(auth.data)
      }
      setConfigLoading(false)
    }
    loadConfig().catch((error) => {
      setConfigLoading(false)
      setConfigError(String(error))
    })
  }, [setAuthState])

  const onSaveConfig = async () => {
    setConfigSaving(true)
    setConfigError(null)
    setConfigMessage(null)
    try {
      const result = await window.dropith.auth.setConfig(appKeyInput, appSecretInput)
      if (!result.success || !result.data) {
        setConfigError(result.error ?? 'Failed to save Dropbox app credentials')
        return
      }
      setConfigState(result.data)
      setAppSecretInput('')
      setConfigMessage('Dropbox app credentials saved securely for this app.')
      const auth = await window.dropith.auth.getState()
      if (auth.success && auth.data) setAuthState(auth.data)
    } finally {
      setConfigSaving(false)
    }
  }

  const onClearConfig = async () => {
    setConfigSaving(true)
    setConfigError(null)
    setConfigMessage(null)
    try {
      const result = await window.dropith.auth.clearConfig()
      if (!result.success || !result.data) {
        setConfigError(result.error ?? 'Failed to clear Dropbox app credentials')
        return
      }
      setConfigState(result.data)
      setAppKeyInput('')
      setAppSecretInput('')
      setConfigMessage('Saved Dropbox app credentials were removed.')
      const auth = await window.dropith.auth.getState()
      if (auth.success && auth.data) setAuthState(auth.data)
    } finally {
      setConfigSaving(false)
    }
  }

  const onConnectToggle = async () => {
    if (!authState.isConnected && !(configState.appKeySet && configState.appSecretSet)) {
      setAuthError('Add Dropbox App Key and App Secret first.')
      return
    }
    setAuthLoading(true)
    setAuthError(null)
    try {
      const result = authState.isConnected
        ? await window.dropith.auth.disconnect()
        : await window.dropith.auth.connect()
      if (!result.success) {
        setAuthError(result.error ?? 'Connection failed')
      } else {
        const auth = await window.dropith.auth.getState()
        if (auth.success && auth.data) setAuthState(auth.data)
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const onSyncNow = async () => {
    setSyncLoading(true)
    try {
      const status = await window.dropith.sync.trigger()
      if (status.success && status.data) setSyncStatus(status.data)
    } finally {
      setSyncLoading(false)
    }
  }

  const lastSyncDate = syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt) : null
  const hasValidLastSyncDate = lastSyncDate !== null && !Number.isNaN(lastSyncDate.getTime())
  const lastSyncDateLabel = hasValidLastSyncDate ? formatDateShort(lastSyncDate.toISOString().slice(0, 10)) : null

  return (
    <Box sx={{ height: '100%', p: 3, overflowY: 'auto' }}>
      <Stack spacing={2.5} sx={{ maxWidth: 720 }}>
        <Typography variant="h5" fontWeight={700}>Settings</Typography>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" fontWeight={700}>Dropbox App Credentials</Typography>
            <Typography variant="body2" color="text.secondary">
            Add your Dropbox App Key and App Secret from Dropbox Developers, then use web-based OAuth connect below.
            </Typography>
            <Typography variant="caption" color="text.secondary">
            Status: {configState.appKeySet && configState.appSecretSet ? 'Configured' : 'Not configured'} ({configState.source})
            </Typography>
            <Stack spacing={1.25}>
              <TextField
                className="app-no-drag"
                size="small"
                value={appKeyInput}
                onChange={(e) => setAppKeyInput(e.target.value)}
                placeholder="Dropbox App Key"
                autoComplete="off"
              />
              <TextField
                className="app-no-drag"
                size="small"
                value={appSecretInput}
                onChange={(e) => setAppSecretInput(e.target.value)}
                placeholder="Dropbox App Secret"
                type="password"
                autoComplete="off"
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                className="app-no-drag"
                variant="contained"
                size="small"
                onClick={onSaveConfig}
                disabled={configSaving || configLoading || !appKeyInput.trim() || !appSecretInput.trim()}
              >
                {configSaving ? 'Saving…' : 'Save credentials'}
              </Button>
              <Button
                className="app-no-drag"
                variant="outlined"
                size="small"
                onClick={onClearConfig}
                disabled={configSaving || configLoading || (!configState.appKeySet && !configState.appSecretSet)}
              >
                Clear saved credentials
              </Button>
            </Stack>
            {configLoading && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">Loading credential status…</Typography>
              </Stack>
            )}
            {configMessage && <Alert severity="success" sx={{ py: 0 }}>{configMessage}</Alert>}
            {configError && <Alert severity="error" sx={{ py: 0 }}>{configError}</Alert>}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" fontWeight={700}>Dropbox Account</Typography>
            <Typography variant="body2" color="text.secondary">
            {authState.isConnected
              ? `Connected as ${authState.accountEmail ?? 'Dropbox account'}.`
              : 'Not connected. Connect Dropbox to browse and sync your project files.'}
            </Typography>
            <Button
              className="app-no-drag"
              variant="contained"
              size="small"
              onClick={onConnectToggle}
              disabled={authLoading || (!authState.isConnected && !(configState.appKeySet && configState.appSecretSet))}
            >
              {authLoading ? 'Working…' : authState.isConnected ? 'Disconnect Dropbox' : 'Connect Dropbox'}
            </Button>
            {authError && <Alert severity="error" sx={{ py: 0 }}>{authError}</Alert>}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" fontWeight={700}>Sync</Typography>
            <Typography variant="body2" color="text.secondary">
            {lastSyncDateLabel ? `Last sync: ${lastSyncDateLabel}` : 'No sync has run yet.'}
            </Typography>
            {syncStatus.error && <Alert severity="error" sx={{ py: 0 }}>{syncStatus.error}</Alert>}
            <Button
              className="app-no-drag"
              variant="contained"
              size="small"
              onClick={onSyncNow}
              disabled={syncLoading}
            >
              {syncLoading ? 'Syncing…' : 'Sync now'}
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  )
}
