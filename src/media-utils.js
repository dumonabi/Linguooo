const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
const RECORDER_STOP_FLUSH_MS = 150;

export function getRecordingMimeType() {
  return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

/** Wait for MediaRecorder stop and let Safari flush the final audio chunk. */
export async function waitForRecorderStop(mediaRecorder) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setTimeout(resolve, RECORDER_STOP_FLUSH_MS);
    };

    const timeout = setTimeout(finish, 8000);

    mediaRecorder.addEventListener('stop', finish, { once: true });
    mediaRecorder.addEventListener('error', () => finish(), { once: true });

    try {
      if (mediaRecorder.state === 'recording' && typeof mediaRecorder.requestData === 'function') {
        mediaRecorder.requestData();
      }
      mediaRecorder.stop();
    } catch {
      finish();
    }
  });
}
