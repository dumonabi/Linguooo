export const VOICE_SAMPLE_TARGET = 6;

const VOICE_UI = {
  es: {
    voiceReady: 'Voz personal lista',
    voiceNotReady: 'Voz personal sin configurar',
    voiceProfile: 'Perfil de voz',
    voiceCopy: `Graba ${VOICE_SAMPLE_TARGET} muestras variadas en tu voz natural: frases normales, preguntas, exclamaciones y un texto un poco más largo. Así la voz clonada captará mejor tu entonación.`,
    samplesRecorded: 'muestras grabadas',
    needsUpdate: 'Has cambiado las muestras. Vuelve a crear el perfil de voz.',
    elevenlabsMissing: 'Añade ELEVENLABS_API_KEY en el archivo .env (sin # al inicio) y reinicia el servidor.',
    readNext: 'Lee esto ahora',
    readingNow: 'Lee esto mientras grabas',
    recordSample: 'Grabar muestra',
    stopSample: 'Parar y guardar',
    cancelRecording: 'Cancelar grabación',
    createVoice: 'Crear mi voz',
    updateVoice: 'Actualizar mi voz',
    creatingVoice: 'Creando tu voz…',
    samplesComplete: `Ya tienes las ${VOICE_SAMPLE_TARGET} muestras. Configurando tu voz…`,
    enoughSamples: 'Muestras completas',
    setupVoice: 'Configurar mi voz',
    savingSample: 'Guardando muestra…',
    discardRecording: 'Descartar grabación',
    recordingBlocked: `Ya tienes ${VOICE_SAMPLE_TARGET} muestras. Descarta esta grabación o elimina una muestra para volver a grabar.`,
    voiceSetupFailed: 'No se pudo configurar la voz:',
    savedSamples: 'Muestras guardadas',
    sampleLabel: 'Muestra',
    deleteSample: 'Eliminar muestra',
    switchUser: 'Cambiar usuario',
  },
  th: {
    voiceReady: 'เสียงส่วนตัวพร้อมแล้ว',
    voiceNotReady: 'ยังไม่ได้ตั้งค่าเสียงส่วนตัว',
    voiceProfile: 'โปรไฟล์เสียง',
    voiceCopy: `บันทึกตัวอย่าง ${VOICE_SAMPLE_TARGET} ครั้งที่หลากหลายด้วยน้ำเสียงตามธรรมชาติ: ประโยคปกติ คำถาม อารมณ์ตื่นเต้น และข้อความที่ยาวขึ้น เพื่อให้เสียงโคลนจับน้ำเสียงของคุณได้ดีขึ้น`,
    samplesRecorded: 'ตัวอย่างที่บันทึกแล้ว',
    needsUpdate: 'คุณเปลี่ยนตัวอย่างเสียงแล้ว โปรดสร้างโปรไฟล์เสียงอีกครั้ง',
    elevenlabsMissing: 'เพิ่ม ELEVENLABS_API_KEY ในไฟล์ .env (ห้ามขึ้นต้นด้วย #) แล้วรีสตาร์ทเซิร์ฟเวอร์',
    readNext: 'อ่านข้อความนี้',
    readingNow: 'อ่านข้อความนี้ขณะบันทึก',
    recordSample: 'บันทึกตัวอย่าง',
    stopSample: 'หยุดและบันทึก',
    cancelRecording: 'ยกเลิกการบันทึก',
    createVoice: 'สร้างเสียงของฉัน',
    updateVoice: 'อัปเดตเสียงของฉัน',
    creatingVoice: 'กำลังสร้างเสียงของคุณ…',
    samplesComplete: `ครบ ${VOICE_SAMPLE_TARGET} ตัวอย่างแล้ว กำลังตั้งค่าเสียงของคุณ…`,
    enoughSamples: 'ตัวอย่างครบแล้ว',
    setupVoice: 'ตั้งค่าเสียงของฉัน',
    savingSample: 'กำลังบันทึกตัวอย่าง…',
    discardRecording: 'ยกเลิกการบันทึก',
    recordingBlocked: `คุณมี ${VOICE_SAMPLE_TARGET} ตัวอย่างแล้ว ยกเลิกการบันทึกนี้หรือลบตัวอย่างเพื่อบันทึกใหม่`,
    voiceSetupFailed: 'ตั้งค่าเสียงไม่สำเร็จ:',
    savedSamples: 'ตัวอย่างที่บันทึกไว้',
    sampleLabel: 'ตัวอย่าง',
    deleteSample: 'ลบตัวอย่าง',
    switchUser: 'เปลี่ยนผู้ใช้',
  },
  en: {
    voiceReady: 'Personal voice ready',
    voiceNotReady: 'Personal voice not set up',
    voiceProfile: 'Voice profile',
    voiceCopy: `Record ${VOICE_SAMPLE_TARGET} varied samples in your natural voice: normal lines, questions, exclamations, and a slightly longer passage. This helps the clone capture your intonation better.`,
    samplesRecorded: 'samples recorded',
    needsUpdate: 'Your voice samples changed. Create the profile again.',
    elevenlabsMissing: 'Add ELEVENLABS_API_KEY to your .env file (no # at the start) and restart the server.',
    readNext: 'Read this next',
    readingNow: 'Read this while recording',
    recordSample: 'Record sample',
    stopSample: 'Stop & save sample',
    cancelRecording: 'Cancel recording',
    createVoice: 'Create my voice',
    updateVoice: 'Update my voice',
    creatingVoice: 'Creating your voice…',
    samplesComplete: `All ${VOICE_SAMPLE_TARGET} samples recorded. Setting up your voice…`,
    enoughSamples: 'Samples complete',
    setupVoice: 'Set up my voice',
    savingSample: 'Saving sample…',
    discardRecording: 'Discard recording',
    recordingBlocked: `You already have ${VOICE_SAMPLE_TARGET} samples. Discard this recording or delete a sample to re-record.`,
    voiceSetupFailed: 'Could not set up voice:',
    savedSamples: 'Saved samples',
    sampleLabel: 'Sample',
    deleteSample: 'Delete sample',
    switchUser: 'Switch user',
  },
};

const VOICE_PROMPTS = {
  es: [
    'Hola, esta es mi voz. Estoy grabando esta muestra para mi perfil personal en Lingu.ooo.',
    '¿Cómo estás hoy? Me gusta hablar con naturalidad, como lo haría con un amigo.',
    '¡Qué bien! Esto suena emocionante, y quiero que se note la energía en mi voz.',
    'A veces explico las cosas con calma: hablo despacio, con claridad, y dejo pausas naturales entre frases.',
    '¿De verdad crees que la entonación cambia tanto cuando hacemos una pregunta?',
    'Cuando leo un mensaje más largo, mantengo el mismo tono de siempre, como si estuviera contándoselo a alguien que conozco bien.',
  ],
  th: [
    'สวัสดี นี่คือเสียงของฉัน ฉันกำลังบันทึกตัวอย่างนี้เพื่อสร้างโปรไฟล์เสียงส่วนตัวใน Lingu.ooo',
    'วันนี้เป็นอย่างไรบ้าง ฉันชอบพูดอย่างเป็นธรรมชาติ เหมือนคุยกับเพื่อนสนิท',
    'เยี่ยมมาก นี่ฟังดูน่าตื่นเต้น และฉันอยากให้พลังงานในคำพูดของฉันออกมาชัดเจน',
    'บางครั้งฉันอธิบายอย่างใจเย็น พูดช้า ชัดเจน และหยุดพักตามจังหวะธรรมชาติ',
    'คุณคิดจริง ๆ ว่าน้ำเสียงเปลี่ยนมากเมื่อเราถามคำถามหรือเปล่า',
    'เมื่อฉันอ่านข้อความที่ยาวขึ้น ฉันยังคงใช้โทนเดิม เหมือนเล่าให้คนที่รู้จักดีฟัง',
  ],
  en: [
    'Hello, this is my voice. I am recording this sample for my personal profile on Lingu.ooo.',
    'How are you today? I like to speak naturally, just like I would with a close friend.',
    'That is great! This sounds exciting, and I want my energy to come through in my voice.',
    'Sometimes I explain things calmly: I speak slowly, clearly, and leave natural pauses between phrases.',
    'Do you really think intonation changes this much when we ask a question?',
    'When I read a longer message, I keep the same everyday tone, as if I were telling someone I know well.',
  ],
};

export function resolveVoiceLanguage(code) {
  const lang = String(code || 'en').toLowerCase().trim();
  if (VOICE_PROMPTS[lang]) return lang;
  return 'en';
}

export function getVoiceUi(code) {
  const lang = resolveVoiceLanguage(code);
  return VOICE_UI[lang];
}

export function getVoicePrompts(code) {
  const lang = resolveVoiceLanguage(code);
  return VOICE_PROMPTS[lang];
}

export function getVoicePrompt(code, sampleCount) {
  const prompts = getVoicePrompts(code);
  return prompts[sampleCount % prompts.length];
}
