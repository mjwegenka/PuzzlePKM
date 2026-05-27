import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { SyncProvider } from './lib/syncContext'

document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SyncProvider>
      <App />
    </SyncProvider>
  </React.StrictMode>,
)
