import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function authDir() {
  return path.join(os.homedir(), '.clikdeploy');
}

export function apiKeyPath() {
  return path.join(authDir(), 'api-key');
}

export function saveUserApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Cannot save empty api key');
  fs.mkdirSync(authDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(apiKeyPath(), `${key}\n`, { mode: 0o600 });
}

export function loadUserApiKey() {
  try {
    const value = fs.readFileSync(apiKeyPath(), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function clearUserApiKey() {
  try {
    fs.unlinkSync(apiKeyPath());
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
