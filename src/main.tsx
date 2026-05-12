import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import App from './App.tsx'
import './index.css'
import { appTheme } from './theme'
import { SyncProvider } from './lib/syncContext'

document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SyncProvider>
        <App />
      </SyncProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
