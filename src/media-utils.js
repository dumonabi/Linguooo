const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
const RECORDER_STOP_FLUSH_MS = 150;
const RECORDER_IOS_EXTRA_FLUSH_MS = 320;

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

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

    const previousOnStop = mediaRecorder.onstop;
    mediaRecorder.onstop = (event) => {
      if (typeof previousOnStop === 'function') previousOnStop.call(mediaRecorder, event);
      finish();
    };

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

/** Build a blob after stop; iOS often delivers the last chunk after `stop`. */
export async function buildRecordingBlob(chunks, mimeType, recorder = null) {
  if (recorder && recorder.state === 'recording') {
    await waitForRecorderStop(recorder);
  }

  await sleep(isIosDevice() ? RECORDER_IOS_EXTRA_FLUSH_MS : RECORDER_STOP_FLUSH_MS);

  let blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) {
    await sleep(RECORDER_IOS_EXTRA_FLUSH_MS);
    blob = new Blob(chunks, { type: mimeType });
  }

  return blob;
}
