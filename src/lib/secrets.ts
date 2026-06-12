import { invoke } from '@tauri-apps/api/core';

// Accounts are namespaced as "provider:<providerId>" e.g. "provider:anthropic"
function accountKey(providerId: string) {
  return `provider:${providerId}`;
}

export async function saveApiKey(providerId: string, secret: string): Promise<void> {
  await invoke('set_secret', { account: accountKey(providerId), secret });
}

export async function loadApiKey(providerId: string): Promise<string | null> {
  return invoke<string | null>('get_secret', { account: accountKey(providerId) });
}

export async function deleteApiKey(providerId: string): Promise<void> {
  await invoke('delete_secret', { account: accountKey(providerId) });
}
