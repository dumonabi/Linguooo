export const VOICE_SAMPLE_TARGET = 6;
export const VOICE_MIN_CLIP_SEC = 8;
export const VOICE_ADVISABLE_CLIP_SEC = 20;
export const VOICE_TARGET_TOTAL_SEC = 90;

const VOICE_UI = {
  es: {
    profileName: 'Nombre',
    voiceReady: 'Voz lista',
    voiceNotReady: 'Sin voz',
    voiceProfile: 'Voz',
    voiceCopy: 'Graba 6 clips con tu voz natural, de unos 20–30 segundos cada uno.',
    samplesRecorded: 'grabadas',
    samplesSaved: 'Audios guardados',
    resetSamples: 'Reiniciar audios',
    needsUpdate: 'Muestras cambiadas — actualiza la voz.',
    elevenlabsMissing: 'Falta ELEVENLABS_API_KEY en .env.',
    readNext: 'Lee',
    readingNow: 'Leyendo',
    recordSample: 'Grabar',
    savingSample: 'Guardando muestra…',
    stopSample: 'Guardar',
    cancelRecording: 'Cancelar',
    createVoice: 'Crear voz',
    updateVoice: 'Actualizar voz',
    creatingVoice: 'Creando…',
    samplesComplete: 'Configurando voz…',
    enoughSamples: 'Listo',
    setupVoice: 'Configurar voz',
    savingSample: 'Guardando…',
    discardRecording: 'Descartar',
    recordingBlocked: 'Ya tienes 6 muestras.',
    durationCaptured: 'voz capturada',
    recordTooShort: 'Graba un poco más — al menos 8 segundos.',
    voiceSetupFailed: 'Error:',
    deleteSample: 'Eliminar muestra',
    switchUser: 'Cerrar sesión',
    editUser: 'Editar perfil',
    recordAgain: 'Grabar de nuevo',
    confirmRecordAgain: '¿Reemplazar todas las muestras? Grabarás 6 de nuevo.',
    recoveryPhrase: 'Frase de recuperación',
    showRecoveryPhrase: 'Ver seed',
    hideRecoveryPhrase: 'Ocultar seed',
    recoveryPhraseMissing: 'No está guardada en este dispositivo. Usa la frase que anotaste al crear la cuenta.',
    copyPhrase: 'Copiar frase',
    copiedPhrase: 'Copiado',
    couldNotCopy: 'No se pudo copiar',
    createAccount: 'Crear cuenta',
    createAccountFailed: 'No se pudo crear la cuenta.',
    cloneVoiceLanguagesFootnote: 'Tu voz funciona en',
    showCloneVoiceLanguages: 'Ver idiomas con tu voz',
    hideCloneVoiceLanguages: 'Ocultar idiomas con tu voz',
    proModeLabel: 'PRO',
    proVoiceCopy: 'Lee los textos en voz alta con naturalidad y expresión, como si hablaras con alguien, hasta reunir 30 minutos. Máximo 3 horas.',
    proSubmit: 'Crear voz PRO',
    proSubmitting: 'Enviando muestras…',
    proSubmittedNote: 'Muestras enviadas a ElevenLabs. Completa la verificación y el entrenamiento en el panel de ElevenLabs; la voz PRO se activará sola al terminar.',
    proRemaining: 'Faltan {min} min de audio',
    proReady: 'Listo para crear tu voz PRO',
    proResetConfirm: '¿Eliminar todas las muestras PRO?',
    proSampleSaved: 'Muestra PRO guardada',
    proSubmitFailed: 'No se pudo crear la voz PRO',
    proDeleteAll: 'Eliminar muestras PRO',
  },
  th: {
    profileName: 'ชื่อ',
    voiceReady: 'เสียงพร้อม',
    voiceNotReady: 'ยังไม่มีเสียง',
    voiceProfile: 'เสียง',
    voiceCopy: 'บันทึก 6 คลิปด้วยน้ำเสียงตามธรรมชาติ คลิปละประมาณ 20–30 วินาที',
    samplesRecorded: 'บันทึกแล้ว',
    samplesSaved: 'เสียงที่บันทึกแล้ว',
    resetSamples: 'รีเซ็ตเสียงที่บันทึก',
    needsUpdate: 'ตัวอย่างเปลี่ยน — อัปเดตเสียง',
    elevenlabsMissing: 'ไม่มี ELEVENLABS_API_KEY ใน .env',
    readNext: 'อ่าน',
    readingNow: 'กำลังอ่าน',
    recordSample: 'บันทึก',
    savingSample: 'กำลังบันทึก…',
    stopSample: 'บันทึก',
    cancelRecording: 'ยกเลิก',
    createVoice: 'สร้างเสียง',
    updateVoice: 'อัปเดตเสียง',
    creatingVoice: 'กำลังสร้าง…',
    samplesComplete: 'กำลังตั้งค่า…',
    enoughSamples: 'ครบแล้ว',
    setupVoice: 'ตั้งค่าเสียง',
    savingSample: 'กำลังบันทึก…',
    discardRecording: 'ยกเลิก',
    recordingBlocked: 'มีครบ 6 ตัวอย่างแล้ว',
    durationCaptured: 'เสียงที่บันทึกแล้ว',
    recordTooShort: 'บันทึกให้นานขึ้น — อย่างน้อย 8 วินาที',
    voiceSetupFailed: 'ผิดพลาด:',
    deleteSample: 'ลบตัวอย่าง',
    switchUser: 'ปิดเซสชัน',
    editUser: 'แก้ไขโปรไฟล์',
    recordAgain: 'บันทึกใหม่',
    confirmRecordAgain: 'แทนที่ตัวอย่างทั้งหมด? คุณจะบันทึกใหม่ 6 ครั้ง',
    recoveryPhrase: 'วลีกู้คืน',
    showRecoveryPhrase: 'Show seed',
    hideRecoveryPhrase: 'Hide seed',
    recoveryPhraseMissing: 'ไม่ได้บันทึกไว้ในอุปกรณ์นี้ ใช้วลีที่คุณบันทึกตอนสร้างบัญชี',
    copyPhrase: 'Copy phrase',
    copiedPhrase: 'Copied',
    couldNotCopy: 'Could not copy',
    createAccount: 'Create account',
    createAccountFailed: 'Could not create account.',
    cloneVoiceLanguagesFootnote: 'เสียงของคุณใช้ได้ใน',
    showCloneVoiceLanguages: 'Show voice languages',
    hideCloneVoiceLanguages: 'Hide voice languages',
    proModeLabel: 'PRO',
    proVoiceCopy: 'อ่านข้อความออกเสียงอย่างเป็นธรรมชาติและมีอารมณ์ เหมือนคุยกับใครสักคน จนครบ 30 นาที สูงสุด 3 ชั่วโมง',
    proSubmit: 'สร้างเสียง PRO',
    proSubmitting: 'กำลังส่งตัวอย่าง…',
    proSubmittedNote: 'ส่งตัวอย่างไปยัง ElevenLabs แล้ว ทำการยืนยันและเทรนในแดชบอร์ด ElevenLabs เสียง PRO จะเปิดใช้เองเมื่อเสร็จ',
    proRemaining: 'ต้องการอีก {min} นาที',
    proReady: 'พร้อมสร้างเสียง PRO แล้ว',
    proResetConfirm: 'ลบตัวอย่าง PRO ทั้งหมด?',
    proSampleSaved: 'บันทึกตัวอย่าง PRO แล้ว',
    proSubmitFailed: 'สร้างเสียง PRO ไม่สำเร็จ',
    proDeleteAll: 'ลบตัวอย่าง PRO',
  },
  en: {
    profileName: 'Name',
    voiceReady: 'Voice ready',
    voiceNotReady: 'No voice yet',
    voiceProfile: 'Voice',
    voiceCopy: 'Record 6 clips in your natural voice, about 20–30 seconds each.',
    samplesRecorded: 'recorded',
    samplesSaved: 'Saved recordings',
    resetSamples: 'Reset recordings',
    needsUpdate: 'Samples changed — update voice.',
    elevenlabsMissing: 'Missing ELEVENLABS_API_KEY in .env.',
    readNext: 'Read',
    readingNow: 'Reading',
    recordSample: 'Record',
    savingSample: 'Saving sample…',
    stopSample: 'Save',
    cancelRecording: 'Cancel',
    createVoice: 'Create voice',
    updateVoice: 'Update voice',
    creatingVoice: 'Creating…',
    samplesComplete: 'Setting up voice…',
    enoughSamples: 'Done',
    setupVoice: 'Set up voice',
    savingSample: 'Saving…',
    discardRecording: 'Discard',
    recordingBlocked: '6 samples full.',
    durationCaptured: 'voice captured',
    recordTooShort: 'Record a little longer — at least 8 seconds.',
    voiceSetupFailed: 'Error:',
    deleteSample: 'Delete sample',
    switchUser: 'Close session',
    editUser: 'Edit profile',
    recordAgain: 'Record again',
    confirmRecordAgain: 'Replace all samples? You’ll record 6 again.',
    recoveryPhrase: 'Recovery phrase',
    showRecoveryPhrase: 'Show seed',
    hideRecoveryPhrase: 'Hide seed',
    recoveryPhraseMissing: 'Not saved on this device. Use the phrase you wrote down when you created your account.',
    copyPhrase: 'Copy phrase',
    copiedPhrase: 'Copied',
    couldNotCopy: 'Could not copy',
    createAccount: 'Create account',
    createAccountFailed: 'Could not create account.',
    cloneVoiceLanguagesFootnote: 'Your voice works in',
    showCloneVoiceLanguages: 'Show voice languages',
    hideCloneVoiceLanguages: 'Hide voice languages',
    proModeLabel: 'PRO',
    proVoiceCopy: 'Read the texts aloud naturally and expressively, as if talking to someone, until you reach 30 minutes. Up to 3 hours.',
    proSubmit: 'Create PRO voice',
    proSubmitting: 'Sending samples…',
    proSubmittedNote: 'Samples sent to ElevenLabs. Finish verification and training in the ElevenLabs dashboard; the PRO voice will link automatically when done.',
    proRemaining: '{min} more minutes of audio to go',
    proReady: 'Ready to create your PRO voice',
    proResetConfirm: 'Delete all PRO samples?',
    proSampleSaved: 'PRO sample saved',
    proSubmitFailed: 'Could not create PRO voice',
    proDeleteAll: 'Delete PRO samples',
  },
};

const VOICE_PROMPTS = {
  es: [
    'Hola, esta es mi voz. Estoy grabando estas muestras más largas para mi perfil personal en Lingu.ooo. Quiero hablar con naturalidad y claridad, como lo haría con alguien que conozco bien en una conversación cotidiana — relajado, sin prisa y fácil de entender desde la primera palabra.',
    '¿Cómo estás hoy? ¿Te ha ido bien esta semana, o ha pasado algo que no esperabas y que todavía te tiene pensando — algo pequeño que se te quedó grabado o algo más grande que cambió tus planes por completo?',
    '¡Qué buena noticia! Me alegra mucho escucharlo, y quiero que mi entusiasmo se note en la voz — en el ritmo, en el tono y en cómo enfatizo ciertas palabras para que el sentimiento sea inconfundible y suene completamente genuino!',
    'A veces explico las cosas con calma y claridad. Hablo a un ritmo constante, dejo pausas naturales entre frases e intento que cada palabra se entienda sin sonar apresurado ni como si leyera un guion que otra persona escribió para mí.',
    'Cuando leo un mensaje más largo en voz alta, me detengo y me pregunto — ¿de verdad crees que la entonación cambia tanto cuando convertimos una frase simple en una pregunta sincera, una que demuestra que te importa de verdad la respuesta?',
    '¡Vaya diferencia que marca un solo tono! Las mismas palabras pueden sonar curiosas, sorprendidas o encantadas — y quiero que mi voz transmita toda esa energía cuando hablo, para que la gente escuche exactamente lo que quiero decir!',
  ],
  th: [
    'สวัสดี นี่คือเสียงของฉัน ฉันกำลังบันทึกตัวอย่างที่ยาวขึ้นเหล่านี้เพื่อสร้างโปรไฟล์เสียงส่วนตัวใน Lingu.ooo ฉันต้องการพูดอย่างเป็นธรรมชาติและชัดเจน เหมือนคุยกับคนที่รู้จักดีในชีวิตประจำวัน — ผ่อนคลาย ไม่รีบ และเข้าใจง่ายตั้งแต่คำแรก',
    'วันนี้เป็นอย่างไรบ้าง สัปดาห์นี้เป็นไปด้วยดีไหม หรือมีเรื่องที่คุณไม่คาดคิดเกิดขึ้นและยังคิดถึงอยู่เรื่อย ๆ — เรื่องเล็ก ๆ ที่ติดอยู่ในหัว หรือเรื่องใหญ่ที่เปลี่ยนแผนของคุณไปเลย?',
    'ข่าวดีมากเลย! ฉันดีใจจริง ๆ ที่ได้ยิน และอยากให้ความตื่นเต้นนั้นออกมาในเสียงของฉัน — ทั้งจังหวะ โทน และการเน้นคำบางคำ เพื่อให้ความรู้สึกนั้นชัดเจนและฟังดูจริงใจอย่างแท้จริง!',
    'บางครั้งฉันอธิบายอย่างใจเย็นและชัดเจน ฉันพูดด้วยจังหวะสม่ำเสมอ หยุดพักตามธรรมชาติระหว่างวลี และพยายามให้ทุกคำเข้าใจง่ายโดยไม่ฟังดูรีบหรือเหมือนกำลังอ่านสคริปต์ที่คนอื่นเขียนให้ฉัน',
    'เมื่อฉันอ่านข้อความที่ยาวขึ้น ฉันอาจหยุดแล้วถามตัวเอง — คุณคิดจริง ๆ ว่าน้ำเสียงเปลี่ยนมากแค่ไหนเมื่อเราเปลี่ยนประโยคธรรมดาให้กลายเป็นคำถามจริงจัง คำถามที่แสดงว่าคุณใส่ใจคำตอบจริง ๆ?',
    'น่าทึ่งมากที่โทนเดียวสร้างความรู้สึกต่างกันได้ขนาดนี้! คำเดิม ๆ อาจฟังดูสงสัย ประหลาดใจ หรือดีใจ — และฉันอยากให้เสียงของฉันสื่อพลังงานนั้นเมื่อพูด เพื่อให้คนอื่นได้ยินสิ่งที่ฉันต้องการสื่ออย่างชัดเจน!',
  ],
  en: [
    'Hello, this is my voice. I am recording these longer samples for my personal profile on Lingu.ooo. I want to speak naturally and clearly, just like I would when talking to someone I know well in everyday conversation — relaxed, unhurried, and easy to understand from the very first word.',
    'How are you today? Has your week been going well, or did something unexpected happen that you are still thinking about — something small that stuck with you, or something bigger that changed your plans completely?',
    'That is wonderful news! I am really happy to hear it, and I want my excitement to come through in my voice — in my pace, my tone, and the way I emphasize certain words so the feeling is unmistakable and sounds completely genuine!',
    'Sometimes I explain things calmly and clearly. I speak at a steady pace, leave natural pauses between phrases, and try to make every word easy to understand without sounding rushed or like I am reading from a script that someone else wrote for me.',
    'When I read a longer message out loud, I might pause and ask — do you really think intonation changes that much when we turn a simple sentence into a genuine question, one that shows you truly care about the answer?',
    'What a difference a single tone can make! The same words can sound curious, surprised, or delighted — and I want my voice to carry all of that energy when I speak, so people hear exactly what I mean!',
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

// Long-form reading passages for Professional Voice Cloning. Modeled on the
// script categories ElevenLabs provides in its PVC recorder (conversational,
// narrative, advertising, educational, Q&A, emotional range, reflective,
// instructional). Each passage takes roughly 2–2.5 minutes to read aloud, so
// two full cycles cover the 30-minute minimum.
const PRO_VOICE_PROMPTS = {
  es: [
    // Conversacional
    'Hola, soy yo otra vez. Hoy quiero contarte cómo ha sido mi semana, porque han pasado bastantes cosas y creo que te vas a reír con alguna. El lunes empecé con toda la energía del mundo: me levanté temprano, preparé café, y me senté a trabajar convencido de que iba a terminar todo lo pendiente. Y claro, a las diez de la mañana ya estaba respondiendo mensajes que no tenían nada que ver con lo que había planeado. ¿Te suena? Seguro que sí, porque a todos nos pasa lo mismo. Lo curioso es que, al final, los días que menos planifico suelen ser los más productivos. El miércoles, por ejemplo, salí a caminar sin rumbo y se me ocurrió una idea que llevaba semanas buscando. Así, sin más, mientras miraba un escaparate. A veces pienso que las mejores ideas llegan cuando dejamos de perseguirlas. En fin, cuéntame tú: ¿cómo va todo por ahí? ¿Sigues con ese proyecto del que me hablaste la última vez? Me quedé con ganas de saber cómo terminó aquello, de verdad. La próxima vez que nos veamos quiero que me lo cuentes todo con calma, sin prisa, con un café delante, como en los viejos tiempos.',
    // Narrativo
    'El tren salió de la estación con veinte minutos de retraso, y nadie a bordo imaginaba que ese pequeño contratiempo iba a cambiarlo todo. Marta ocupó su asiento junto a la ventana y observó cómo la ciudad se deshacía lentamente en campos amarillos. Llevaba en el bolso una carta que no se había atrevido a abrir, escrita con una letra que reconoció al instante, aunque hacía quince años que no la veía. El paisaje corría hacia atrás mientras sus pensamientos corrían hacia adelante. En la estación siguiente subió un hombre mayor con un violín, se sentó frente a ella y le sonrió como se sonríe a los desconocidos: con cortesía y sin intención. Pero cuando el tren atravesó el túnel más largo del trayecto, en esa oscuridad repentina que huele a hierro y a viaje, el hombre dijo en voz baja: «Hay cartas que esperan años a ser leídas, y no por eso llegan tarde». Marta lo miró, sorprendida. No le había contado nada. El tren salió del túnel, la luz volvió de golpe, y el asiento de enfrente estaba vacío. Solo quedaba el violín, y sobre el violín, una nota escrita con aquella misma letra que ella conocía tan bien.',
    // Publicitario / entusiasta
    '¡Escucha esto, porque no te lo vas a creer! ¿Cuántas veces has querido aprender un idioma y lo has dejado a las dos semanas? A mí me pasaba todos los años. Enero: motivación total. Febrero: la aplicación acumulando polvo digital. ¡Pues se acabó! Imagina poder hablar con cualquier persona del mundo, en su idioma, con tu propia voz. No una voz robótica, no una voz de otra persona: la tuya, con tu tono, con tu forma de reír, con tus pausas. Eso es exactamente lo que hace esta tecnología, y funciona de verdad. La primera vez que la probé me quedé sin palabras, que es justo lo contrario de lo que promete. Mi madre la escuchó y me preguntó cuándo había aprendido tailandés. ¡Tailandés! ¡Yo, que no sé pedir un café en francés! Y lo mejor de todo es lo fácil que resulta: hablas, traduces y escuchas tu propia voz diciendo cosas que jamás pensaste que dirías. Increíble, ¿verdad? Pues todavía hay más. Cada conversación suena natural, fluida, tuya. Pruébalo una vez, solo una, y luego me cuentas quién es el que no puede parar de enseñárselo a todo el mundo.',
    // Educativo
    'Hoy quiero explicarte, con calma, cómo funciona algo que usamos todos los días sin pensarlo: la voz humana. Cuando hablas, el aire sale de tus pulmones y atraviesa la laringe, donde dos pequeños pliegues, las cuerdas vocales, vibran cientos de veces por segundo. Esa vibración es el sonido básico, una especie de zumbido crudo. Lo interesante viene después. Ese zumbido sube por la garganta y entra en la boca, que actúa como una sala de conciertos en miniatura. La lengua, los labios, los dientes y el paladar modelan el sonido igual que un escultor modela la arcilla. Si acercas la lengua al paladar, obtienes un sonido; si redondeas los labios, otro completamente distinto. Por eso cada persona suena diferente: no hay dos bocas iguales, ni dos gargantas iguales, ni dos maneras iguales de respirar. Tu voz es, literalmente, tu huella sonora. Y hay algo más que me parece fascinante: la entonación. No es solo lo que dices, sino la música con la que lo dices. Una misma frase puede ser una pregunta, una orden o una broma, dependiendo únicamente de cómo sube y baja el tono. Esa melodía invisible es la que hace que una voz suene viva.',
    // Pregunta y respuesta
    '¿Sabes qué me preguntaron el otro día? Que si pudiera cenar con cualquier persona de la historia, a quién elegiría. Y me quedé pensando un buen rato, porque la pregunta parece fácil hasta que intentas responderla. ¿Un científico? ¿Una escritora? ¿Algún familiar que ya no está? Al final dije que mi abuela, y la conversación se puso seria de repente. ¿Por qué será que las preguntas sencillas son las que más nos descolocan? Luego me preguntaron otra: ¿prefieres poder volar o ser invisible? Yo lo tengo clarísimo: volar, sin dudarlo un segundo. ¿Invisible para qué? ¿Para escuchar conversaciones ajenas? No, gracias, bastante tengo con las mías. ¿Y tú qué elegirías? Piénsalo bien antes de contestar, porque dicen que la respuesta revela cómo eres. Los que eligen volar buscan libertad; los que eligen ser invisibles buscan información. No sé si será verdad, pero desde entonces miro distinto a la gente que responde rápido. Una última pregunta, y esta es la buena: si tu voz pudiera hablar todos los idiomas del mundo, ¿cuál sería el primero que querrías escuchar? Yo ya lo sé. Lo supe en cuanto terminé de leer la pregunta.',
    // Rango emocional
    '¡No te lo vas a creer! ¡Me han dado la noticia esta mañana y todavía estoy temblando de la emoción! ¿Te acuerdas de aquello que llevaba meses esperando? ¡Pues salió! ¡Salió de verdad! Tuve que leer el mensaje tres veces porque pensaba que lo estaba entendiendo mal. Llamé a mi familia gritando y mi hermano me colgó porque creyó que había pasado algo malo. Algo malo, imagínate, con la alegría que llevaba encima. Aunque, te soy sincero, también hubo un momento raro. Cuando pasó la euforia, me senté en la cocina y me quedé en silencio, pensando en todo el camino hasta aquí. En los días grises, en las veces que estuve a punto de rendirme, en la gente que me dijo que no valía la pena intentarlo. Y sentí una especie de pena dulce, no sé cómo explicarlo. Como cuando terminas un libro que te ha gustado mucho y no quieres empezar otro todavía. Luego respiré hondo, me serví un vaso de agua, y me permití simplemente estar contento. Sin planes, sin siguiente paso, sin pensar en mañana. Solo contento. Hacía muchísimo tiempo que no me daba ese permiso, y te aseguro que sienta de maravilla.',
    // Reflexivo
    'Hay una hora del día que me gusta más que ninguna otra: ese momento en que la tarde todavía no ha terminado pero la noche ya se anuncia, cuando la luz se vuelve dorada y todo parece moverse un poco más despacio. Suelo salir al balcón sin el teléfono, cosa rara en mí, y me quedo mirando los tejados. Pienso en las personas que viven detrás de cada ventana encendida, cada una con su historia, sus preocupaciones, sus pequeñas alegrías que nadie más conoce. De niño creía que los adultos tenían todas las respuestas. Ahora que soy uno de ellos, sé que vamos improvisando casi todo, y no me parece mal: hay algo hermoso en aprender sobre la marcha. Me acuerdo mucho de mi primera casa, del ruido de la cafetera por las mañanas, de una lámpara amarilla que daba una luz imposible de encontrar en ninguna tienda. Qué extraño es el tiempo. Los días se hacen largos y los años cortos. Si pudiera decirle algo a quien fui hace diez años, le diría que se preocupe menos por el futuro y preste más atención a lo pequeño: un café caliente, una conversación sin reloj, la luz dorada de las siete de la tarde. Al final, resulta que eso era lo importante.',
    // Instructivo
    'Te voy a explicar mi receta favorita para el fin de semana, la que nunca falla: pan casero, del de verdad. Apunta, que es más fácil de lo que parece. Necesitas quinientos gramos de harina, diez gramos de sal, unos trescientos mililitros de agua tibia y una cucharadita de levadura. Primero mezcla la harina y la sal en un cuenco grande. Aparte, disuelve la levadura en el agua y espera cinco minutos, hasta que empiece a burbujear un poquito. Junta las dos cosas y remueve con la mano, sin miedo, hasta que no quede harina seca. Ahora viene el secreto: no hace falta amasar como un loco. Tapa el cuenco con un paño y déjalo reposar una hora. Pasado ese tiempo, dobla la masa sobre sí misma cuatro o cinco veces, con suavidad, y déjala descansar otra hora más. Enciende el horno bien fuerte, a doscientos treinta grados, con una olla de hierro dentro si tienes. Pon la masa en la olla, tapa, y hornea treinta minutos. Después destapa y deja diez minutos más, hasta que la corteza suene hueca al golpearla. Y ahora, lo más difícil de toda la receta: esperar a que se enfríe antes de cortarlo. Nadie lo consigue a la primera.',
  ],
  th: [
    // สนทนา
    'สวัสดี ฉันเองอีกแล้วนะ วันนี้อยากเล่าให้ฟังว่าสัปดาห์นี้เป็นอย่างไรบ้าง เพราะมีเรื่องเกิดขึ้นเยอะเลย และคิดว่าบางเรื่องน่าจะทำให้คุณขำได้ วันจันทร์ฉันเริ่มต้นด้วยพลังเต็มเปี่ยม ตื่นเช้า ชงกาแฟ แล้วนั่งลงทำงานด้วยความมั่นใจว่าจะเคลียร์ทุกอย่างที่ค้างอยู่ให้หมด แต่พอสิบโมงเช้า ฉันก็นั่งตอบข้อความที่ไม่เกี่ยวอะไรกับแผนที่วางไว้เลย คุ้น ๆ ไหม ฉันว่าทุกคนเป็นเหมือนกันหมด ที่ตลกคือ วันที่ฉันวางแผนน้อยที่สุดกลับกลายเป็นวันที่ได้งานมากที่สุด อย่างวันพุธ ฉันออกไปเดินเล่นแบบไม่มีจุดหมาย แล้วจู่ ๆ ก็คิดไอเดียที่ตามหามาหลายสัปดาห์ได้ ง่าย ๆ แบบนั้นเลย ระหว่างยืนมองหน้าร้านร้านหนึ่ง บางทีฉันก็คิดว่าไอเดียดี ๆ มักมาตอนที่เราเลิกไล่ตามมัน เอาเถอะ เล่าให้ฟังบ้างสิ ทางนั้นเป็นอย่างไรบ้าง ยังทำโปรเจกต์ที่เล่าให้ฟังครั้งก่อนอยู่ไหม ฉันอยากรู้จริง ๆ ว่าเรื่องนั้นจบอย่างไร ไว้เจอกันคราวหน้า อยากให้เล่าให้ฟังทั้งหมดแบบช้า ๆ ไม่ต้องรีบ มีกาแฟวางตรงหน้า เหมือนเมื่อก่อนนะ',
    // เล่าเรื่อง
    'รถไฟออกจากสถานีช้ากว่ากำหนดยี่สิบนาที และไม่มีใครบนขบวนคิดเลยว่าความล่าช้าเล็ก ๆ นั้นจะเปลี่ยนทุกอย่าง มาร์ตานั่งลงข้างหน้าต่าง มองเมืองค่อย ๆ สลายกลายเป็นทุ่งสีเหลือง ในกระเป๋าของเธอมีจดหมายฉบับหนึ่งที่เธอไม่กล้าเปิด ลายมือบนซองนั้นเธอจำได้ทันที แม้จะไม่ได้เห็นมันมาสิบห้าปีแล้ว ทิวทัศน์วิ่งถอยหลังขณะที่ความคิดของเธอวิ่งไปข้างหน้า ที่สถานีถัดมา ชายสูงวัยคนหนึ่งถือไวโอลินขึ้นมา นั่งลงตรงข้ามเธอ และยิ้มให้แบบที่คนแปลกหน้ายิ้มให้กัน สุภาพและไม่มีนัยอะไร แต่เมื่อรถไฟลอดเข้าอุโมงค์ที่ยาวที่สุดของเส้นทาง ในความมืดฉับพลันที่มีกลิ่นเหล็กและกลิ่นการเดินทาง ชายคนนั้นพูดเบา ๆ ว่า มีจดหมายบางฉบับที่รอคอยหลายปีกว่าจะถูกอ่าน แต่นั่นไม่ได้แปลว่ามันมาสาย มาร์ตามองเขาด้วยความประหลาดใจ เธอไม่ได้เล่าอะไรให้เขาฟังเลย รถไฟออกจากอุโมงค์ แสงสว่างกลับมาทันที และที่นั่งตรงข้ามก็ว่างเปล่า เหลือเพียงไวโอลิน และบนไวโอลินมีโน้ตแผ่นหนึ่ง เขียนด้วยลายมือเดียวกันกับที่เธอรู้จักดี',
    // โฆษณา / กระตือรือร้น
    'ฟังนี่ก่อน เพราะคุณจะไม่เชื่อแน่ ๆ! คุณเคยอยากเรียนภาษาแล้วเลิกไปหลังจากสองสัปดาห์กี่ครั้งแล้ว ฉันเป็นแบบนั้นทุกปีเลย มกราคม ไฟแรงสุด ๆ กุมภาพันธ์ แอปเริ่มเก็บฝุ่นดิจิทัล แต่พอแล้ว! ลองนึกดูว่าคุณคุยกับใครก็ได้ในโลก ด้วยภาษาของเขา แต่ด้วยเสียงของคุณเอง ไม่ใช่เสียงหุ่นยนต์ ไม่ใช่เสียงของคนอื่น เสียงของคุณจริง ๆ พร้อมโทน พร้อมจังหวะหัวเราะ พร้อมช่วงหยุดหายใจของคุณ นั่นแหละคือสิ่งที่เทคโนโลยีนี้ทำได้ และมันได้ผลจริง ครั้งแรกที่ฉันลอง ฉันถึงกับพูดไม่ออก ซึ่งตรงข้ามกับที่มันสัญญาไว้เลย แม่ของฉันได้ยินแล้วถามว่าฉันไปเรียนภาษาไทยมาตั้งแต่เมื่อไหร่ ภาษาไทยนะ! ทั้งที่ฉันสั่งกาแฟเป็นภาษาฝรั่งเศสยังไม่ได้เลย! และที่ดีที่สุดคือมันง่ายมาก คุณพูด มันแปล แล้วคุณก็ได้ยินเสียงตัวเองพูดในสิ่งที่ไม่เคยคิดว่าจะพูดได้ เหลือเชื่อใช่ไหม ยังมีอีกนะ ทุกบทสนทนาฟังดูเป็นธรรมชาติ ลื่นไหล และเป็นตัวคุณ ลองสักครั้ง แค่ครั้งเดียว แล้วมาเล่าให้ฟังว่าใครกันแน่ที่หยุดโชว์ให้คนรอบตัวดูไม่ได้',
    // ให้ความรู้
    'วันนี้ฉันอยากอธิบายอย่างช้า ๆ ว่าสิ่งที่เราใช้ทุกวันโดยไม่ทันคิดทำงานอย่างไร นั่นคือเสียงของมนุษย์ เมื่อคุณพูด อากาศออกจากปอดผ่านกล่องเสียง ซึ่งมีเนื้อเยื่อเล็ก ๆ สองแผ่นที่เรียกว่าเส้นเสียง สั่นสะเทือนหลายร้อยครั้งต่อวินาที การสั่นนั้นคือเสียงพื้นฐาน คล้ายเสียงหึ่งดิบ ๆ ส่วนที่น่าสนใจอยู่หลังจากนั้น เสียงหึ่งนั้นเดินทางขึ้นมาตามลำคอแล้วเข้าสู่ช่องปาก ซึ่งทำหน้าที่เหมือนหอแสดงดนตรีขนาดจิ๋ว ลิ้น ริมฝีปาก ฟัน และเพดานปากช่วยกันปั้นเสียงเหมือนช่างปั้นปั้นดินเหนียว ถ้าคุณยกลิ้นเข้าใกล้เพดานปาก จะได้เสียงหนึ่ง ถ้าห่อริมฝีปาก จะได้อีกเสียงที่ต่างออกไปโดยสิ้นเชิง เพราะอย่างนี้แต่ละคนจึงมีเสียงไม่เหมือนกัน ไม่มีปากสองปากที่เหมือนกัน ไม่มีลำคอสองลำคอที่เหมือนกัน และไม่มีวิธีหายใจแบบเดียวกัน เสียงของคุณคือลายนิ้วมือทางเสียงของคุณจริง ๆ และยังมีอีกอย่างที่ฉันว่าน่าทึ่ง คือทำนองเสียง ไม่ใช่แค่สิ่งที่คุณพูด แต่คือดนตรีที่คุณใช้พูดมัน ประโยคเดียวกันอาจเป็นคำถาม คำสั่ง หรือคำหยอกล้อ ขึ้นอยู่กับว่าเสียงขึ้นลงอย่างไรเท่านั้น ทำนองที่มองไม่เห็นนี้แหละที่ทำให้เสียงฟังดูมีชีวิต',
    // ถามตอบ
    'รู้ไหมว่ามีคนถามอะไรฉันเมื่อวันก่อน เขาถามว่าถ้าได้กินข้าวเย็นกับใครก็ได้ในประวัติศาสตร์ จะเลือกใคร ฉันนั่งคิดอยู่นานเลย เพราะคำถามนี้ดูง่ายจนกว่าคุณจะพยายามตอบมันจริง ๆ นักวิทยาศาสตร์ดีไหม หรือนักเขียน หรือญาติที่จากไปแล้ว สุดท้ายฉันตอบว่ายายของฉัน แล้วบทสนทนาก็จริงจังขึ้นมาทันที ทำไมคำถามง่าย ๆ ถึงทำให้เราสะดุดได้มากที่สุดนะ แล้วเขาก็ถามอีกข้อ ชอบบินได้หรือหายตัวได้มากกว่ากัน อันนี้ฉันชัดเจนมาก บินได้ ไม่ลังเลสักวินาที หายตัวไปทำไม ไปแอบฟังคนอื่นคุยกันหรือ ไม่ล่ะ ขอบคุณ เรื่องของตัวเองก็เยอะพอแล้ว แล้วคุณล่ะจะเลือกอะไร คิดดี ๆ ก่อนตอบนะ เพราะเขาว่ากันว่าคำตอบบอกนิสัยเราได้ คนที่เลือกบินได้กำลังมองหาอิสรภาพ คนที่เลือกหายตัวได้กำลังมองหาข้อมูล จริงไม่จริงไม่รู้ แต่ตั้งแต่นั้นมาฉันก็มองคนที่ตอบเร็ว ๆ เปลี่ยนไปเลย คำถามสุดท้าย และข้อนี้สำคัญที่สุด ถ้าเสียงของคุณพูดได้ทุกภาษาในโลก ภาษาแรกที่คุณอยากได้ยินคือภาษาอะไร ฉันรู้คำตอบของตัวเองแล้ว รู้ตั้งแต่อ่านคำถามจบเลย',
    // อารมณ์หลากหลาย
    'คุณจะไม่เชื่อแน่ ๆ! ฉันเพิ่งได้รับข่าวเมื่อเช้านี้ และตอนนี้ยังตัวสั่นด้วยความตื่นเต้นอยู่เลย! จำเรื่องที่ฉันรอมาหลายเดือนได้ไหม สำเร็จแล้ว! สำเร็จจริง ๆ! ฉันต้องอ่านข้อความสามรอบเพราะคิดว่าตัวเองเข้าใจผิด โทรหาครอบครัวพลางตะโกน จนพี่ชายวางสายเพราะนึกว่าเกิดเรื่องร้าย เรื่องร้ายเหรอ คิดดูสิ ทั้งที่ฉันดีใจจนล้นขนาดนั้น แต่บอกตามตรง มันก็มีช่วงเวลาแปลก ๆ อยู่เหมือนกัน พอความตื่นเต้นซาลง ฉันนั่งเงียบ ๆ ในครัว คิดถึงเส้นทางทั้งหมดที่ผ่านมา วันหม่น ๆ ครั้งที่เกือบยอมแพ้ คนที่เคยบอกว่าไม่คุ้มหรอกที่จะพยายาม แล้วฉันก็รู้สึกถึงความเศร้าหวาน ๆ บางอย่าง อธิบายไม่ถูกเหมือนกัน เหมือนตอนอ่านหนังสือเล่มโปรดจบ แล้วยังไม่อยากเริ่มเล่มใหม่ จากนั้นฉันหายใจลึก ๆ รินน้ำหนึ่งแก้ว แล้วอนุญาตให้ตัวเองมีความสุขเฉย ๆ ไม่มีแผน ไม่มีก้าวต่อไป ไม่คิดถึงพรุ่งนี้ แค่มีความสุข นานมากแล้วที่ฉันไม่ได้ให้สิทธิ์นั้นกับตัวเอง และบอกเลยว่ามันรู้สึกดีเหลือเกิน',
    // ใคร่ครวญ
    'มีช่วงเวลาหนึ่งของวันที่ฉันชอบมากกว่าช่วงไหน ๆ คือตอนที่บ่ายยังไม่จบแต่ค่ำเริ่มส่งสัญญาณ ตอนที่แสงกลายเป็นสีทองและทุกอย่างเหมือนเคลื่อนช้าลงเล็กน้อย ฉันมักออกไปที่ระเบียงโดยไม่พกโทรศัพท์ ซึ่งแปลกมากสำหรับฉัน แล้วยืนมองหลังคาบ้านเรือน คิดถึงผู้คนที่อยู่หลังหน้าต่างแต่ละบานที่เปิดไฟ แต่ละคนมีเรื่องราวของตัวเอง มีความกังวล มีความสุขเล็ก ๆ ที่ไม่มีใครรู้ ตอนเด็กฉันเชื่อว่าผู้ใหญ่มีคำตอบทุกอย่าง ตอนนี้พอเป็นผู้ใหญ่เองแล้ว ฉันรู้ว่าเราแทบทุกคนกำลังด้นสดกันทั้งนั้น และฉันว่านั่นไม่ใช่เรื่องแย่เลย การเรียนรู้ไประหว่างทางมีความงามของมันอยู่ ฉันคิดถึงบ้านหลังแรกบ่อย ๆ เสียงเครื่องชงกาแฟตอนเช้า โคมไฟสีเหลืองที่ให้แสงแบบที่หาซื้อจากร้านไหนไม่ได้อีกแล้ว เวลาช่างประหลาด วันมันยาวแต่ปีมันสั้น ถ้าฉันบอกอะไรกับตัวเองเมื่อสิบปีก่อนได้ ฉันจะบอกให้กังวลกับอนาคตน้อยลง แล้วใส่ใจสิ่งเล็ก ๆ ให้มากขึ้น กาแฟร้อนสักแก้ว บทสนทนาที่ไม่ต้องดูนาฬิกา แสงสีทองตอนหนึ่งทุ่ม สุดท้ายแล้ว กลายเป็นว่าสิ่งเหล่านั้นแหละที่สำคัญที่สุด',
    // สอนทำ
    'ฉันจะบอกสูตรโปรดสำหรับวันหยุดสุดสัปดาห์ให้ฟัง สูตรที่ไม่เคยพลาดเลย ขนมปังโฮมเมดของแท้ จดไว้นะ ง่ายกว่าที่คิดเยอะ คุณต้องใช้แป้งห้าร้อยกรัม เกลือสิบกรัม น้ำอุ่นประมาณสามร้อยมิลลิลิตร และยีสต์หนึ่งช้อนชา ขั้นแรก ผสมแป้งกับเกลือในชามใบใหญ่ อีกภาชนะหนึ่ง ละลายยีสต์ในน้ำแล้วรอห้านาทีจนเริ่มมีฟองเล็ก ๆ เทสองอย่างรวมกันแล้วใช้มือคนอย่างไม่ต้องกลัว จนไม่เหลือแป้งแห้ง ทีนี้ถึงเคล็ดลับสำคัญ ไม่ต้องนวดจนเหนื่อย แค่คลุมชามด้วยผ้าแล้วพักไว้หนึ่งชั่วโมง จากนั้นพับแป้งทบตัวเองสี่ห้าครั้งเบา ๆ แล้วพักต่ออีกหนึ่งชั่วโมง เปิดเตาอบให้ร้อนจัดที่สองร้อยสามสิบองศา ถ้ามีหม้อเหล็กก็ใส่เข้าไปอุ่นด้วย วางแป้งลงในหม้อ ปิดฝา อบสามสิบนาที แล้วเปิดฝาอบต่ออีกสิบนาที จนเคาะเปลือกแล้วมีเสียงกลวง และนี่คือขั้นตอนที่ยากที่สุดของสูตรทั้งหมด รอให้ขนมปังเย็นก่อนหั่น ไม่มีใครทำสำเร็จตั้งแต่ครั้งแรกหรอก',
  ],
  en: [
    // Conversational
    'Hey, it’s me again. I want to tell you about my week, because quite a lot happened and I think some of it will make you laugh. On Monday I started with all the energy in the world: I got up early, made coffee, and sat down to work convinced I was going to finish everything on my list. And of course, by ten in the morning I was already answering messages that had nothing to do with anything I had planned. Sound familiar? I’m sure it does, because it happens to all of us. The funny thing is that the days I plan the least usually turn out to be the most productive. On Wednesday, for example, I went out for a walk with no destination at all, and an idea I had been chasing for weeks just appeared. Just like that, while I was looking at a shop window. Sometimes I think the best ideas arrive precisely when we stop chasing them. Anyway, tell me about you: how is everything over there? Are you still working on that project you mentioned last time? I really do want to know how that turned out. Next time we see each other, I want the full story, slowly, no rushing, with a coffee in front of us, like the old days.',
    // Narrative
    'The train left the station twenty minutes late, and nobody on board imagined that this small delay was about to change everything. Marta took her seat by the window and watched the city slowly dissolve into yellow fields. In her bag she carried a letter she had not dared to open, written in a handwriting she recognized instantly, even though she had not seen it in fifteen years. The landscape ran backwards while her thoughts ran forward. At the next station, an old man boarded with a violin, sat down across from her, and smiled the way strangers smile: politely, and without intention. But when the train entered the longest tunnel of the route, in that sudden darkness that smells of iron and travel, the man said quietly: “Some letters wait years to be read, and that does not make them late.” Marta stared at him, startled. She had told him nothing. The train burst out of the tunnel, the light returned all at once, and the seat across from her was empty. Only the violin remained, and resting on the violin, a note written in that same handwriting she knew so well.',
    // Advertising / enthusiastic
    'Listen to this, because you are not going to believe it! How many times have you decided to learn a language and given up after two weeks? That used to be me, every single year. January: total motivation. February: the app gathering digital dust. Well, not anymore! Imagine being able to talk to anyone in the world, in their language, with your own voice. Not a robotic voice, not somebody else’s voice: yours, with your tone, your way of laughing, your pauses. That is exactly what this technology does, and it truly works. The first time I tried it, I was left speechless — which is exactly the opposite of what it promises. My mother heard it and asked me when I had learned Thai. Thai! Me, who can’t even order a coffee in French! And the best part is how easy it is: you speak, it translates, and you hear your own voice saying things you never imagined you would say. Incredible, right? Well, there’s more. Every conversation sounds natural, fluid, and completely yours. Try it once, just once, and then come tell me who’s the one who can’t stop showing it to everybody they know.',
    // Educational
    'Today I want to explain, calmly, how something we use every day without thinking actually works: the human voice. When you speak, air leaves your lungs and passes through the larynx, where two small folds — the vocal cords — vibrate hundreds of times per second. That vibration is the basic sound, a kind of raw buzz. The interesting part comes next. That buzz travels up the throat and enters the mouth, which acts like a miniature concert hall. The tongue, the lips, the teeth and the palate shape the sound the way a sculptor shapes clay. Bring your tongue close to the palate and you get one sound; round your lips and you get a completely different one. That is why every person sounds unique: no two mouths are alike, no two throats are alike, and no two people breathe the same way. Your voice is, quite literally, your acoustic fingerprint. And there is something else I find fascinating: intonation. It is not just what you say, but the music you say it with. The very same sentence can be a question, a command or a joke, depending only on how the pitch rises and falls. That invisible melody is what makes a voice sound alive.',
    // Q&A
    'You know what somebody asked me the other day? If I could have dinner with anyone in history, who would I choose. And I sat there thinking for a long while, because the question seems easy until you actually try to answer it. A scientist? A writer? A relative who is no longer here? In the end I said my grandmother, and the conversation suddenly turned serious. Why is it that the simplest questions are the ones that catch us most off guard? Then they asked me another one: would you rather be able to fly, or be invisible? For me this one is obvious: flying, without a second of doubt. Invisible for what? To eavesdrop on other people’s conversations? No thank you, I have enough with my own. And you, which would you choose? Think carefully before you answer, because they say the answer reveals who you are. People who choose flying are looking for freedom; people who choose invisibility are looking for information. I don’t know if that is true, but ever since then I look differently at people who answer too quickly. One last question, and this is the good one: if your voice could speak every language in the world, which one would you want to hear first? I already know mine. I knew it the moment I finished reading the question.',
    // Emotional range
    'You are not going to believe this! I got the news this morning and I am still shaking with excitement! Remember that thing I had been waiting on for months? It happened! It actually happened! I had to read the message three times because I was sure I was misunderstanding it. I called my family shouting, and my brother hung up on me because he thought something terrible had happened. Something terrible — imagine that, with all the joy I was carrying. Although, to be honest, there was also a strange moment. When the euphoria faded, I sat down in the kitchen and went quiet, thinking about the whole road that led here. The gray days, the times I almost gave up, the people who told me it wasn’t worth trying. And I felt a kind of sweet sadness, I don’t quite know how to explain it. Like when you finish a book you loved and you are not ready to start another one yet. Then I took a deep breath, poured myself a glass of water, and allowed myself to simply be happy. No plans, no next step, no thinking about tomorrow. Just happy. It had been a very long time since I gave myself that permission, and I promise you, it feels wonderful.',
    // Reflective
    'There is one hour of the day I love more than any other: that moment when the afternoon is not quite over but the evening is already announcing itself, when the light turns golden and everything seems to move a little more slowly. I usually step out onto the balcony without my phone — rare for me — and I stand there looking at the rooftops. I think about the people living behind every lit window, each with their own story, their worries, their small joys that nobody else knows about. As a child I believed adults had all the answers. Now that I am one of them, I know we are improvising almost everything, and honestly, I don’t mind: there is something beautiful about learning as you go. I often remember my first home, the sound of the coffee maker in the morning, a yellow lamp that gave off a light you could never find in any store again. How strange time is. The days feel long and the years feel short. If I could say something to the person I was ten years ago, I would tell him to worry less about the future and pay more attention to the small things: a hot coffee, a conversation without a clock, the golden light at seven in the evening. In the end, it turns out that was the important part.',
    // Instructional
    'Let me share my favorite weekend recipe, the one that never fails: real homemade bread. Write this down, because it is easier than it looks. You need five hundred grams of flour, ten grams of salt, about three hundred milliliters of warm water, and a teaspoon of yeast. First, mix the flour and the salt in a large bowl. Separately, dissolve the yeast in the water and wait five minutes, until it starts to bubble just a little. Combine the two and stir with your hand, don’t be afraid, until no dry flour remains. Now comes the secret: there is no need to knead like a maniac. Cover the bowl with a cloth and let it rest for an hour. After that, fold the dough over itself four or five times, gently, and let it rest for another hour. Heat the oven good and hot, to two hundred and thirty degrees, with a cast iron pot inside if you have one. Place the dough in the pot, put the lid on, and bake for thirty minutes. Then uncover it and give it ten more minutes, until the crust sounds hollow when you tap it. And now, the hardest step of the entire recipe: waiting for it to cool before you slice it. Nobody manages that on the first try.',
  ],
};

export function getProVoicePrompts(code) {
  const lang = resolveVoiceLanguage(code);
  return PRO_VOICE_PROMPTS[lang];
}

export function getProVoicePrompt(code, sampleCount) {
  const prompts = getProVoicePrompts(code);
  return prompts[sampleCount % prompts.length];
}
