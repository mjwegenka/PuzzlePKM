import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { invoke } from '@tauri-apps/api/core'

interface CliRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

const presetCommands = [
  'help',
  'auth status',
  'settings show',
  'list topic-note',
  'list daily-note',
  'sync',
]

function tokenizeCommand(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const tokens: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'") {
      quote = 'single'
      continue
    }

    if (char === '"') {
      quote = 'double'
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

async function runDropithCli(args: string[]): Promise<CliRunResult> {
  return invoke<CliRunResult>('run_dropith_cli', { args })
}

export default function App() {
  const [commandText, setCommandText] = useState('help')
  const [output, setOutput] = useState('')
  const [errorOutput, setErrorOutput] = useState('')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [transportError, setTransportError] = useState<string | null>(null)

  const parsedArgs = useMemo(() => tokenizeCommand(commandText), [commandText])

  const execute = async () => {
    setTransportError(null)
    setRunning(true)
    try {
      const result = await runDropithCli(parsedArgs)
      setOutput(result.stdout || '')
      setErrorOutput(result.stderr || '')
      setExitCode(result.exitCode)
    } catch (error) {
      setTransportError(String(error))
      setOutput('')
      setErrorOutput('')
      setExitCode(null)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', py: 6, px: 2, bgcolor: '#0b1828' }}>
      <Container maxWidth="lg">
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, bgcolor: '#0e2038' }}>
          <Stack spacing={3}>
            <div>
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Dropith Desktop
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This desktop shell runs the same `cli.mjs` commands you already use in the terminal.
              </Typography>
            </div>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {presetCommands.map((preset) => (
                <Chip
                  key={preset}
                  label={preset}
                  onClick={() => setCommandText(preset)}
                  variant="outlined"
                  sx={{ borderColor: '#1c3558', color: '#e4f0fb' }}
                />
              ))}
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                fullWidth
                label="CLI command"
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
                placeholder="Examples: list daily-note | get topic-note <id> | sync --watch --interval 5"
                helperText="Enter command arguments without the leading `dropith` keyword."
              />
              <Button
                variant="contained"
                onClick={() => void execute()}
                disabled={running || parsedArgs.length === 0}
                sx={{ minWidth: 140 }}
              >
                {running ? 'Running...' : 'Run'}
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Parsed args:
              </Typography>
              <Box component="code" sx={{ fontSize: 12, color: '#7dbad6' }}>
                {JSON.stringify(parsedArgs)}
              </Box>
            </Stack>

            {transportError ? (
              <Alert severity="error">
                Could not reach the desktop command bridge. Start the app with Tauri (`npm run tauri:dev`).
                <br />
                {transportError}
              </Alert>
            ) : null}

            {exitCode !== null ? (
              <Alert severity={exitCode === 0 ? 'success' : 'warning'}>
                Command finished with exit code {exitCode}.
              </Alert>
            ) : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Paper variant="outlined" sx={{ flex: 1, p: 2, bgcolor: '#0b1828', borderColor: '#1c3558' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  stdout
                </Typography>
                <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontSize: 12, minHeight: 200 }}>
                  {output || '(empty)'}
                </Box>
              </Paper>
              <Paper variant="outlined" sx={{ flex: 1, p: 2, bgcolor: '#0b1828', borderColor: '#1c3558' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  stderr
                </Typography>
                <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontSize: 12, minHeight: 200 }}>
                  {errorOutput || '(empty)'}
                </Box>
              </Paper>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}

