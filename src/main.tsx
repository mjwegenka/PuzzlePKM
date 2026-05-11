import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter } from 'react-router-dom'
import AppWrapper from './App.tsx'
import './lib/ipc.ts'
import './index.css'
import { appTheme } from './theme'

document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <BrowserRouter>
        <AppWrapper />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
