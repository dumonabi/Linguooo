// Live transcription over a direct browser → OpenAI Realtime connection.
//
// The app server only mints a short-lived credential (/api/realtime-session);
// the mic audio itself streams over WebRTC straight to OpenAI, and partial
// transcripts come back over the peer connection's data channel while the
// user is still speaking. There is deliberately no fallback path: if this
// connection cannot be established, recording fails with an error.

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CONNECT_TIMEOUT_MS = 12000;
// After the user stops, how long to wait for the transcript of the final
// committed audio segment before giving up and using what we have.
const FINALIZE_TIMEOUT_MS = 2500;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function waitForChannelOpen(channel) {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.onopen = () => resolve();
    channel.onerror = () => reject(new Error('Live transcription channel failed'));
  });
}

// Connects and resolves with a transcriber handle once the data channel is
// open. Rejects if the session cannot be established within the timeout.
// `clientSecret` may be a promise: the SDP offer is prepared while the
// ephemeral credential is still being minted, so neither waits on the other.
export async function connectRealtimeTranscriber({ stream, clientSecret, onText, onError }) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track) throw new Error('No microphone track');

  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel('oai-events');
  pc.addTrack(track, stream);

  // Transcripts arrive per committed speech segment (item). Deltas stream
  // while a segment is being transcribed; `completed` carries its final text.
  const items = new Map();
  const order = [];
  let speechActive = false;
  let fatalError = null;
  let pendingFinalize = null;

  const ensureItem = (id) => {
    if (!id) return null;
    if (!items.has(id)) {
      items.set(id, { text: '', completed: false });
      order.push(id);
    }
    return items.get(id);
  };

  const assemble = () => order
    .map((id) => items.get(id)?.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hasIncomplete = () => speechActive || order.some((id) => !items.get(id).completed);

  const handleServerEvent = (event) => {
    switch (event?.type) {
      case 'input_audio_buffer.speech_started':
        speechActive = true;
        break;
      case 'input_audio_buffer.speech_stopped':
        speechActive = false;
        break;
      case 'input_audio_buffer.committed':
        // Track the committed segment so stop() waits for its transcript.
        speechActive = false;
        ensureItem(event.item_id);
        pendingFinalize?.check();
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        const item = ensureItem(event.item_id);
        if (item && !item.completed) {
          item.text += event.delta || '';
          onText?.(assemble());
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const item = ensureItem(event.item_id);
        if (item) {
          item.text = String(event.transcript || '').trim();
          item.completed = true;
          onText?.(assemble());
          pendingFinalize?.check();
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const item = ensureItem(event.item_id);
        if (item) {
          item.completed = true;
          pendingFinalize?.check();
        }
        break;
      }
      case 'error': {
        const message = event.error?.message || '';
        // Committing an empty buffer (user stopped without new speech) is
        // expected and harmless; anything else kills the session.
        if (/buffer too small|input_audio_buffer_commit_empty/i.test(message)) {
          pendingFinalize?.check({ force: true });
          break;
        }
        fatalError = new Error(message || 'Live transcription failed');
        pendingFinalize?.check({ force: true });
        onError?.(fatalError);
        break;
      }
      default:
        break;
    }
  };

  channel.onmessage = (messageEvent) => {
    try {
      handleServerEvent(JSON.parse(messageEvent.data));
    } catch {
      // Non-JSON payloads are ignored.
    }
  };

  const close = () => {
    try {
      channel.close();
    } catch {
      // already closed
    }
    try {
      pc.close();
    } catch {
      // already closed
    }
  };

  try {
    await withTimeout(
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const secret = await clientSecret;
        const response = await fetch(REALTIME_CALLS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        });
        if (!response.ok) {
          throw new Error('Live transcription connection was rejected');
        }
        const answerSdp = await response.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        await waitForChannelOpen(channel);
      })(),
      CONNECT_TIMEOUT_MS,
      'Could not connect to live transcription — check your internet',
    );
  } catch (err) {
    close();
    throw err;
  }

  return {
    // Commits any audio still in the buffer, waits briefly for its final
    // transcript, closes the connection, and returns the assembled text.
    async stop() {
      if (hasIncomplete()) {
        try {
          channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        } catch {
          // Channel already closed; use what we have.
        }
        await new Promise((resolve) => {
          const timer = setTimeout(finish, FINALIZE_TIMEOUT_MS);
          function finish() {
            clearTimeout(timer);
            pendingFinalize = null;
            resolve();
          }
          pendingFinalize = {
            check({ force = false } = {}) {
              if (force || !hasIncomplete()) finish();
            },
          };
          pendingFinalize.check();
        });
      }
      close();
      if (fatalError && !assemble()) throw fatalError;
      return assemble();
    },

    cancel() {
      close();
    },
  };
}
