import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDb, closeDb } from './db/db.js'
import { registerNotesIpc } from './ipc/notes.js'
import { registerObjectsIpc } from './ipc/objects.js'
import { registerAuthIpc } from './ipc/auth.js'
import { registerSyncIpc, triggerSync } from './ipc/sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
let autoSyncTimer: NodeJS.Timeout | null = null
// Auto-sync every 5 minutes.
const AUTO_SYNC_INTERVAL_MS = 300000

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Dropith',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Topic Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => win?.webContents.send('menu:new-note'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => win?.webContents.send('menu:save'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Toggle Edit Mode',
          accelerator: 'CmdOrCtrl+E',
          click: () => win?.webContents.send('menu:toggle-edit'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Quick Search',
          accelerator: 'CmdOrCtrl+K',
          click: () => win?.webContents.send('menu:quick-search'),
        },
        {
          label: 'Full-text Search',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => win?.webContents.send('menu:search'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Sync',
      submenu: [
        {
          label: 'Sync Now',
          click: () => { triggerSync().catch(console.error); },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    icon: path.join(process.env.VITE_PUBLIC, 'icons', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer)
    autoSyncTimer = null
  }
  closeDb()
})

app.whenReady().then(() => {
  try {
    initDb()
    console.log('[Main] Database initialized');
  } catch (err) {
    console.error('[Main] Database initialization failed:', err);
  }

  try {
    registerNotesIpc()
    registerObjectsIpc()
    registerAuthIpc()
    registerSyncIpc()
    console.log('[Main] IPC handlers registered');
  } catch (err) {
    console.error('[Main] IPC registration failed:', err);
  }

  buildMenu()
  createWindow()
  autoSyncTimer = setInterval(() => {
    triggerSync().catch(console.error)
  }, AUTO_SYNC_INTERVAL_MS)
})
