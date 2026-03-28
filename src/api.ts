import type {
  CheckAuthResponse,
  ExtensionSettings,
  GenerateReplyPayload,
  GenerateReplyResponse,
  ReplyResultPayload
} from './types';

function ensureSettings(settings: ExtensionSettings) {
  if (!settings.backendBaseUrl) {
    throw new Error('Не указан backend URL');
  }
  if (!settings.apiKey) {
    throw new Error('Не указан API-ключ');
  }
}

function debugLog(stage: string, payload: unknown) {
  console.info(`[OZON Auto Reply] ${stage}`, payload);
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data?.message || data?.error || JSON.stringify(data);
  } catch {
    return `${response.status} ${response.statusText}`.trim();
  }
}

async function postJson<T>(
  url: string,
  options: {
    body: unknown;
    apiKey?: string;
  }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  debugLog('request', {
    url,
    body: options.body,
    hasApiKey: Boolean(options.apiKey)
  });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body)
  });

  if (!response.ok) {
    const errorText = await parseError(response);
    debugLog('response:error', {
      url,
      status: response.status,
      error: errorText
    });
    throw new Error(errorText);
  }

  const data = (await response.json()) as T;
  debugLog('response:ok', {
    url,
    data
  });
  return data;
}

export async function checkConnection(settings: ExtensionSettings): Promise<CheckAuthResponse> {
  ensureSettings(settings);
  return postJson<CheckAuthResponse>(`${settings.backendBaseUrl}/v1/extension/auth/check`, {
    apiKey: settings.apiKey,
    body: {}
  });
}

export async function generateReply(
  settings: ExtensionSettings,
  payload: GenerateReplyPayload
): Promise<GenerateReplyResponse> {
  ensureSettings(settings);
  return postJson<GenerateReplyResponse>(`${settings.backendBaseUrl}/v1/replies/generate`, {
    apiKey: settings.apiKey,
    body: payload
  });
}

export async function reportReplyResult(
  settings: ExtensionSettings,
  payload: ReplyResultPayload
): Promise<unknown> {
  if (!settings.backendBaseUrl) {
    throw new Error('Не указан backend URL');
  }

  return postJson<unknown>(`${settings.backendBaseUrl}/v1/replies/result`, {
    apiKey: settings.apiKey || undefined,
    body: payload
  });
}
