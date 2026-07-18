export const MEDIA_MOCK_INIT_SCRIPT = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  };

  // Fake WebRTC peer connection standing in for the direct browser → OpenAI
  // live transcription session. It behaves like a transcription session with
  // server VAD: speech starts shortly after connecting, and committing the
  // audio buffer produces delta + completed transcript events. Tests choose
  // the transcript per recording via window.__realtimeTranscripts.
  window.__realtimeTranscripts = window.__realtimeTranscripts || ['hola', 'สวัสดี'];
  let sessionCount = 0;

  class MockDataChannel {
    constructor(transcript) {
      this.readyState = 'connecting';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._transcript = transcript;
      this._itemSeq = 0;
    }

    _emit(event) {
      if (this.readyState !== 'open') return;
      this.onmessage?.({ data: JSON.stringify(event) });
    }

    _open() {
      this.readyState = 'open';
      this.onopen?.();
      window.__realtimeChannel = this;
      setTimeout(() => this._emit({ type: 'input_audio_buffer.speech_started' }), 30);
    }

    send(payload) {
      let event = {};
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.type !== 'input_audio_buffer.commit') return;
      const itemId = `item_${++this._itemSeq}`;
      const transcript = this._transcript;
      setTimeout(() => {
        this._emit({ type: 'input_audio_buffer.committed', item_id: itemId });
        this._emit({
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: itemId,
          delta: transcript,
        });
        this._emit({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: itemId,
          transcript,
        });
      }, 40);
    }

    close() {
      this.readyState = 'closed';
    }
  }

  class MockRTCPeerConnection {
    createDataChannel() {
      const transcripts = window.__realtimeTranscripts;
      const transcript = transcripts[Math.min(sessionCount, transcripts.length - 1)];
      sessionCount += 1;
      this._channel = new MockDataChannel(transcript);
      return this._channel;
    }

    addTrack() {}

    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\nmock-offer' };
    }

    async setLocalDescription() {}

    async setRemoteDescription() {
      queueMicrotask(() => this._channel?._open());
    }

    close() {
      this._channel?.close();
    }
  }

  window.RTCPeerConnection = MockRTCPeerConnection;

  // Lets tests stream transcript events mid-recording (live preview).
  window.__emitRealtime = (event) => {
    window.__realtimeChannel?._emit(event);
  };
};
