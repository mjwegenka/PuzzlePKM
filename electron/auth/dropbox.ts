import { shell } from 'electron';
import http from 'node:http';
import { URL } from 'node:url';
import { getSecret, setSecret, deleteSecret } from './keychain.js';

// Dropbox OAuth credentials.
// Credentials can come from either secure in-app settings or environment variables.
// See: https://www.dropbox.com/developers/apps
const REDIRECT_URI = 'http://localhost:42813/callback';
const KEYCHAIN_ACCESS_TOKEN = 'dropbox_access_token';
const KEYCHAIN_ACCOUNT_EMAIL = 'dropbox_account_email';
const KEYCHAIN_ROOT_FOLDER = 'dropbox_root_folder';
const KEYCHAIN_APP_KEY = 'dropbox_app_key';
const KEYCHAIN_APP_SECRET = 'dropbox_app_secret';

type ConfigSource = 'in-app' | 'environment' | 'mixed' | 'none';

interface ResolvedDropboxConfig {
  appKey: string;
  appSecret: string;
  appKeySource: 'in-app' | 'environment' | 'none';
  appSecretSource: 'in-app' | 'environment' | 'none';
}

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

async function resolveDropboxConfig(): Promise<ResolvedDropboxConfig> {
  const savedKey = normalized(await getSecret(KEYCHAIN_APP_KEY));
  const savedSecret = normalized(await getSecret(KEYCHAIN_APP_SECRET));
  const envKey = normalized(process.env.DROPBOX_APP_KEY);
  const envSecret = normalized(process.env.DROPBOX_APP_SECRET);

  return {
    appKey: savedKey || envKey,
    appSecret: savedSecret || envSecret,
    appKeySource: savedKey ? 'in-app' : (envKey ? 'environment' : 'none'),
    appSecretSource: savedSecret ? 'in-app' : (envSecret ? 'environment' : 'none'),
  };
}

function getConfigSource(config: ResolvedDropboxConfig): ConfigSource {
  if (config.appKeySource === 'none' && config.appSecretSource === 'none') return 'none';
  if (config.appKeySource === 'in-app' && config.appSecretSource === 'in-app') return 'in-app';
  if (config.appKeySource === 'environment' && config.appSecretSource === 'environment') return 'environment';
  return 'mixed';
}

export async function getDropboxAccessToken(): Promise<string | null> {
  return getSecret(KEYCHAIN_ACCESS_TOKEN);
}

export async function getDropboxAuthState() {
  const config = await resolveDropboxConfig();
  const token = await getSecret(KEYCHAIN_ACCESS_TOKEN);
  const accountEmail = await getSecret(KEYCHAIN_ACCOUNT_EMAIL);
  const rootFolder = await getSecret(KEYCHAIN_ROOT_FOLDER);
  return {
    isConnected: !!token,
    isConfigured: !!config.appKey && !!config.appSecret,
    accountEmail: accountEmail ?? undefined,
    rootFolder: rootFolder ?? undefined,
  };
}

export async function getDropboxConfigState() {
  const config = await resolveDropboxConfig();
  return {
    appKeySet: !!config.appKey,
    appSecretSet: !!config.appSecret,
    source: getConfigSource(config),
  };
}

export async function saveDropboxConfig(appKey: string, appSecret: string): Promise<void> {
  const key = normalized(appKey);
  const secret = normalized(appSecret);
  if (!key || !secret) {
    throw new Error('Both Dropbox App Key and App Secret are required');
  }
  await setSecret(KEYCHAIN_APP_KEY, key);
  await setSecret(KEYCHAIN_APP_SECRET, secret);
}

export async function clearDropboxConfig(): Promise<void> {
  await deleteSecret(KEYCHAIN_APP_KEY);
  await deleteSecret(KEYCHAIN_APP_SECRET);
}

export async function disconnectDropbox(): Promise<void> {
  await deleteSecret(KEYCHAIN_ACCESS_TOKEN);
  await deleteSecret(KEYCHAIN_ACCOUNT_EMAIL);
  await deleteSecret(KEYCHAIN_ROOT_FOLDER);
}

function buildAuthUrl(state: string, appKey: string): string {
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    token_access_type: 'offline',
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code: string, appKey: string, appSecret: string): Promise<{ access_token: string; account_id: string }> {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    client_id: appKey,
    client_secret: appSecret,
  });

  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Dropbox token exchange failed: ${response.statusText}`);
  }

  return response.json() as Promise<{ access_token: string; account_id: string }>;
}

async function getAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return '';
  const data = await response.json() as { email?: string };
  return data.email ?? '';
}

export async function connectDropbox(): Promise<{ success: boolean; error?: string }> {
  const config = await resolveDropboxConfig();
  if (!config.appKey || !config.appSecret) {
    return { success: false, error: 'Dropbox App Key/App Secret are not configured' };
  }

  const state = crypto.randomUUID();
  const authUrl = buildAuthUrl(state, config.appKey);

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      if (url.pathname !== '/callback') {
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (!code || returnedState !== state) {
        res.end('<html><body>Authorization failed. You can close this window.</body></html>');
        server.close();
        resolve({ success: false, error: 'Invalid state or missing code' });
        return;
      }

      try {
        const tokens = await exchangeCode(code, config.appKey, config.appSecret);
        const email = await getAccountEmail(tokens.access_token);
        await setSecret(KEYCHAIN_ACCESS_TOKEN, tokens.access_token);
        await setSecret(KEYCHAIN_ACCOUNT_EMAIL, email);
        res.end('<html><body>Connected to Dropbox! You can close this window.</body></html>');
        server.close();
        resolve({ success: true });
      } catch (err) {
        res.end('<html><body>Authorization failed. You can close this window.</body></html>');
        server.close();
        resolve({ success: false, error: String(err) });
      }
    });

    server.listen(42813, () => {
      shell.openExternal(authUrl);
    });

    server.on('error', (err) => {
      resolve({ success: false, error: String(err) });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 300_000);
  });
}
