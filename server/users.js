import crypto from 'crypto';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getLegacyAppPassword() {
  return process.env.APP_PASSWORD?.trim() || null;
}

export function loadUserRegistry() {
  const users = [];
  const raw = process.env.APP_USERS?.trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const password = entry?.password?.trim();
          const id = entry?.id?.trim();
          const name = entry?.name?.trim();
          if (!password || !id || !name) continue;
          users.push({
            password,
            id,
            name,
            nativeLanguage: entry.nativeLanguage?.trim()?.toLowerCase() || 'en',
            elevenlabsVoiceId: entry.elevenlabsVoiceId?.trim() || null,
          });
        }
      }
    } catch (err) {
      console.error('Invalid APP_USERS JSON:', err.message);
    }
  }

  const legacy = getLegacyAppPassword();
  if (legacy && !users.some((user) => timingSafeEqual(user.password, legacy))) {
    users.unshift({
      id: 'owner',
      name: 'You',
      password: legacy,
      nativeLanguage: 'en',
      elevenlabsVoiceId: null,
    });
  }

  return users;
}

export function isAuthRequired() {
  return loadUserRegistry().length > 0;
}

export function findUserByPassword(attempt) {
  if (typeof attempt !== 'string' || !attempt) return null;

  for (const user of loadUserRegistry()) {
    if (timingSafeEqual(attempt, user.password)) {
      return {
        id: user.id,
        name: user.name,
        nativeLanguage: user.nativeLanguage || 'en',
        elevenlabsVoiceId: user.elevenlabsVoiceId || null,
      };
    }
  }

  return null;
}

export function getGuestUser() {
  return { id: 'guest', name: 'Guest', nativeLanguage: 'en', elevenlabsVoiceId: null };
}

export function publicUserProfile(user, voiceProfile = null) {
  const voiceReady = Boolean(
    voiceProfile?.elevenlabsVoiceId || user?.elevenlabsVoiceId
  );

  return {
    id: user.id,
    name: user.name,
    nativeLanguage: user.nativeLanguage || 'en',
    voiceReady,
    voiceSampleCount: voiceProfile?.samples?.length || 0,
    voiceStatus: voiceProfile?.status || (voiceReady ? 'ready' : 'none'),
  };
}
