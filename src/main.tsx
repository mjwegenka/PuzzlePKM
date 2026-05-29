import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { RootErrorBoundary } from './components/app-shell/RootErrorBoundary'
import './index.css'
import { SyncProvider } from './lib/syncContext'

document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <SyncProvider>
        <App />
      </SyncProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
)
