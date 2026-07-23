export const MEDIA_MOCK_INIT_SCRIPT = () => {
  class MockMediaRecorder {
    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || 'audio/webm';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this._listeners = { stop: [], dataavailable: [] };
    }

    addEventListener(type, fn) {
      this._listeners[type]?.push(fn);
    }

    removeEventListener(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    }

    static isTypeSupported(type) {
      return String(type).includes('webm') || String(type).includes('mp4') || String(type).includes('ogg');
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const data = new Uint8Array(1400);
      const blob = new Blob([data], { type: this.mimeType });
      const event = { data: blob, size: blob.size };
      this.ondataavailable?.(event);
      this._listeners.dataavailable.forEach((fn) => fn(event));
      queueMicrotask(() => {
        this.onstop?.();
        this._listeners.stop.forEach((fn) => fn());
      });
    }

    requestData() {
      const data = new Uint8Array(900);
      const blob = new Blob([data], { type: this.mimeType });
      this.ondataavailable?.({ data: blob, size: blob.size });
    }
  }

  navigator.mediaDevices.getUserMedia = async () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  };

  window.MediaRecorder = MockMediaRecorder;
};
