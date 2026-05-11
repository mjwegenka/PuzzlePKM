import { ipcMain } from 'electron';
import { IPC } from '../../src/shared/ipcChannels.js';
import type { IpcResult } from '../../src/shared/types.js';
import {
  clearDropboxConfig,
  connectDropbox,
  disconnectDropbox,
  getDropboxAuthState,
  getDropboxConfigState,
  saveDropboxConfig,
} from '../auth/dropbox.js';

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail(error: string): IpcResult<never> {
  return { success: false, error };
}

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_GET_STATE, async () => {
    try { return ok(await getDropboxAuthState()); }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.AUTH_GET_CONFIG, async () => {
    try { return ok(await getDropboxConfigState()); }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.AUTH_SET_CONFIG, async (_event, appKey: string, appSecret: string) => {
    try {
      await saveDropboxConfig(appKey, appSecret);
      return ok(await getDropboxConfigState());
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.AUTH_CLEAR_CONFIG, async () => {
    try {
      await clearDropboxConfig();
      return ok(await getDropboxConfigState());
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.AUTH_CONNECT_DROPBOX, async () => {
    try {
      const result = await connectDropbox();
      if (!result.success) return fail(result.error ?? 'Connection failed');
      return ok(await getDropboxAuthState());
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.AUTH_DISCONNECT_DROPBOX, async () => {
    try {
      await disconnectDropbox();
      return ok({ isConnected: false });
    } catch (e) { return fail(String(e)); }
  });
}
