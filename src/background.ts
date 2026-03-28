import { checkConnection, generateReply, reportReplyResult } from './api';
import { getSettings, saveSettings } from './storage';
import type { BackgroundRequest, BackgroundResponse } from './types';

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings({});
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      const response: BackgroundResponse = {
        ok: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      };
      sendResponse(response);
    });

  return true;
});

async function handleMessage(message: BackgroundRequest): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }

    case 'SAVE_SETTINGS': {
      const settings = await saveSettings(message.payload);
      return { ok: true, data: settings };
    }

    case 'CHECK_CONNECTION': {
      const settings = await getSettings();
      const data = await checkConnection(settings);
      return { ok: true, data };
    }

    case 'GENERATE_REPLY': {
      const settings = await getSettings();
      const data = await generateReply(settings, message.payload);
      return { ok: true, data };
    }

    case 'REPORT_RESULT': {
      const settings = await getSettings();
      const data = await reportReplyResult(settings, message.payload);
      return { ok: true, data };
    }

    default:
      return { ok: false, error: 'Неподдерживаемый тип сообщения' };
  }
}
