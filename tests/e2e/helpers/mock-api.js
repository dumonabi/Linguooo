const SAMPLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'th', name: 'Thai' },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   authRequired?: boolean;
 *   user?: object;
 *   onConverse?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 *   onTranslate?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 *   onTranscribe?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 * }} options
 */
export async function setupApiMocks(page, options = {}) {
  const {
    authRequired = false,
    user: userOverrides = {},
    voiceProfile: voiceProfileOverrides = {},
    onConverse,
    onTranslate,
    onTranscribe,
    onChatSend,
    chat: chatOptions = {},
  } = options;
  let converseCount = 0;
  let translateCount = 0;
  let transcribeCount = 0;

  // Stateful profile settings, like the real server: PUTs merge slot names
  // last-write-wins and tests can preseed "another device's" rename.
  const settings = {
    stored: {
      slots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
      slotNames: {},
      slotNamesUpdatedAt: {},
      activeSlot: 1,
      voiceLangBySlot: {},
      voiceSlots: [],
      updatedAt: null,
      ...(options.profileSettings ?? {}),
    },
    puts: [],
  };

  const chat = {
    code: chatOptions.code ?? 'MyCode11',
    userId: chatOptions.userId ?? 'test-user',
    // Codes that can be added as contacts, keyed by code.
    users: { Friend12: { id: 'contact-1', name: 'Ana' }, ...(chatOptions.users ?? {}) },
    // Cloned so a test that renames a contact never mutates a fixture
    // object shared with other tests.
    contacts: (chatOptions.contacts ?? []).map((c) => ({ ...c })),
    messages: [...(chatOptions.messages ?? [])],
    sendCount: 0,
    pushIncoming(msg) {
      this.messages.push({
        id: `m-in-${this.messages.length}`,
        createdAt: Date.now(),
        ...msg,
      });
    },
  };

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/health') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          authRequired,
          cloneVoiceLanguages: ['en', 'es', 'fr', 'de', 'ja', 'zh', 'it', 'pt', 'vi'],
          cloneVoiceLanguagesByModel: {
            flash: ['en', 'es', 'fr', 'de', 'ja', 'zh', 'it', 'pt', 'vi'],
          },
        }),
      });
    }

    if (path === '/api/auth/register') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: {
            id: 'test-user-new',
            name: 'User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
          },
          recoveryPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        }),
      });
    }

    if (path === '/api/languages') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SAMPLE_LANGUAGES),
      });
    }

    if (path === '/api/auth/verify') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: {
            id: 'test-user',
            name: 'Test User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
            ...userOverrides,
          },
        }),
      });
    }

    if (path === '/api/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'test-user',
            name: 'Test User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
            ...userOverrides,
          },
          voiceProfile: {
            status: 'none',
            sampleCount: 0,
            voiceReady: false,
            elevenlabsConfigured: false,
            minSamples: 6,
            maxSamples: 6,
            canRecordMore: true,
            totalDurationMs: 0,
            targetDurationMs: 90000,
            ...voiceProfileOverrides,
          },
        }),
      });
    }

    if (path === '/api/profile/settings') {
      if (route.request().method() === 'PUT') {
        let body = {};
        try {
          body = route.request().postDataJSON();
        } catch {
          body = {};
        }
        settings.puts.push(body);

        // Same last-write-wins merge as the real server.
        const names = {};
        const namesAt = {};
        const slots = new Set([
          ...Object.keys(settings.stored.slotNames),
          ...Object.keys(settings.stored.slotNamesUpdatedAt),
          ...Object.keys(body.slotNames || {}),
          ...Object.keys(body.slotNamesUpdatedAt || {}),
        ]);
        for (const slot of slots) {
          const inputAt = Number(body.slotNamesUpdatedAt?.[slot]) || 0;
          const storedAt = Number(settings.stored.slotNamesUpdatedAt[slot]) || 0;
          const useInput = inputAt >= storedAt;
          const name = useInput ? body.slotNames?.[slot] : settings.stored.slotNames[slot];
          const at = useInput ? inputAt : storedAt;
          if (name) names[slot] = name;
          if (at) namesAt[slot] = at;
        }

        settings.stored = {
          ...settings.stored,
          ...body,
          slotNames: names,
          slotNamesUpdatedAt: namesAt,
          voiceSlots: settings.stored.voiceSlots,
          updatedAt: Date.now(),
        };
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settings.stored),
      });
    }

    if (path === '/api/voice/profile') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'none',
          sampleCount: 0,
          samples: [],
          voiceReady: false,
          elevenlabsConfigured: false,
          minSamples: 6,
          maxSamples: 6,
          canRecordMore: true,
          totalDurationMs: 0,
          targetDurationMs: 90000,
          ...voiceProfileOverrides,
        }),
      });
    }

    if (path === '/api/transcribe') {
      const index = transcribeCount++;
      const payload = onTranscribe
        ? await onTranscribe(route.request(), index)
        : onConverse
          ? await onConverse(route.request(), index)
          : defaultConverseResponse(index);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rawText: payload.rawText }),
      });
    }

    if (path === '/api/translate') {
      const index = translateCount++;
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || '{}');
      } catch {
        body = {};
      }

      const payload = onTranslate
        ? await onTranslate(route.request(), index)
        : onConverse
          ? await onConverse(route.request(), index)
          : defaultConverseResponse(index);

      const status = payload.__status ?? 200;
      delete payload.__status;
      payload.rawText = body.text || payload.rawText;
      payload.sourceText = payload.rawText;

      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(payload.error ? payload : { error: 'Request failed' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: buildConverseStreamBody(payload),
      });
    }

    if (path === '/api/converse') {
      const index = converseCount++;
      const payload = onConverse
        ? await onConverse(route.request(), index)
        : defaultConverseResponse(index);

      const status = payload.__status ?? 200;
      delete payload.__status;

      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(payload.error ? payload : { error: 'Request failed' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: buildConverseStreamBody(payload),
      });
    }

    if (path === '/api/speak') {
      const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: Buffer.from(bytes),
      });
    }

    if (path === '/api/contacts') {
      if (route.request().method() === 'POST') {
        let body = {};
        try {
          body = JSON.parse(route.request().postData() || '{}');
        } catch {
          body = {};
        }
        const target = chat.users[body.code];
        if (!target) {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'No user found with that code' }),
          });
        }
        // The alias picked when adding wins over the profile name, like the
        // real server does.
        const name = String(body.name || '').trim().slice(0, 24) || target.name;
        if (!chat.contacts.some((c) => c.id === target.id)) {
          chat.contacts.push({ id: target.id, name, code: body.code });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, contact: { id: target.id, name, code: body.code } }),
        });
      }
      const contacts = chat.contacts.map((c) => {
        const last = chat.messages.filter((m) => m.from === c.id || m.to === c.id).at(-1);
        return {
          ...c,
          lastMessageId: last?.id ?? null,
          lastMessageFrom: last?.from ?? null,
          lastMessageAt: last?.createdAt ?? null,
        };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: chat.code, userId: chat.userId, contacts }),
      });
    }

    if (path.startsWith('/api/contacts/') && route.request().method() === 'PATCH') {
      const targetId = decodeURIComponent(path.slice('/api/contacts/'.length));
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || '{}');
      } catch {
        body = {};
      }
      const entry = chat.contacts.find((c) => c.id === targetId);
      if (!entry) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not one of your contacts' }),
        });
      }
      const profileName = Object.values(chat.users).find((u) => u.id === targetId)?.name || entry.name;
      entry.name = String(body.name || '').trim().slice(0, 24) || profileName;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, contact: { id: entry.id, name: entry.name, code: entry.code } }),
      });
    }

    if (path === '/api/chat/send') {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || '{}');
      } catch {
        body = {};
      }
      const index = chat.sendCount++;
      const payload = onChatSend ? await onChatSend(route.request(), index) : null;
      const status = payload?.__status ?? 200;
      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ error: payload?.error || 'Request failed' }),
        });
      }
      const message = {
        id: `m-sent-${index}`,
        from: chat.userId,
        to: body.to,
        text: payload?.text ?? `[${body.lang2}] ${body.text}`,
        sourceText: body.text,
        sourceLang: body.lang1,
        targetLang: body.lang2,
        createdAt: Date.now(),
      };
      chat.messages.push(message);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message }),
      });
    }

    if (path === '/api/chat/messages') {
      const withId = url.searchParams.get('with');
      const after = url.searchParams.get('after');
      let msgs = chat.messages.filter((m) => m.from === withId || m.to === withId);
      if (after) {
        const i = msgs.findIndex((m) => m.id === after);
        if (i >= 0) msgs = msgs.slice(i + 1);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: msgs }),
      });
    }

    return route.fulfill({ status: 404, body: 'Not found' });
  });

  return { chat, settings };
}

function defaultConverseResponse(index) {
  const samples = [
    {
      rawText: 'hola',
      detectedLanguage: 'es',
      sourceText: 'hola',
      translatedText: 'hello',
      targetLanguage: 'en',
    },
    {
      rawText: 'สวัสดี',
      detectedLanguage: 'th',
      sourceText: 'สวัสดี',
      translatedText: 'hola',
      targetLanguage: 'es',
    },
  ];
  return samples[index] ?? samples[samples.length - 1];
}

function buildConverseStreamBody(payload) {
  const lines = [];
  lines.push(JSON.stringify({
    event: 'transcript',
    rawText: payload.rawText,
    targetLanguage: payload.targetLanguage,
  }));

  const text = payload.translatedText || '';
  for (let i = 0; i < text.length; i += 2) {
    lines.push(JSON.stringify({ event: 'delta', text: text.slice(i, i + 2) }));
  }

  lines.push(JSON.stringify({
    event: 'done',
    rawText: payload.rawText,
    detectedLanguage: payload.detectedLanguage,
    sourceText: payload.sourceText || payload.rawText,
    translatedText: payload.translatedText,
    targetLanguage: payload.targetLanguage,
  }));

  return `${lines.join('\n')}\n`;
}

export async function resetClientState(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('lingu-pending');
    indexedDB.deleteDatabase('lingu-auth');
  });
}
