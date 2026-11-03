// syki::sok speech stream client: talks to speech.cpp local server via OpenAI Realtime WebSocket (/v1/realtime).
(function (global) {
  'use strict';

  function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  function base64EncodePCM(pcm16) {
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function createSpeechStream(opts) {
    const wsUrl = opts.wsUrl;
    const stream = opts.mediaStream;
    const onDelta = opts.onDelta || function () {};
    const onComplete = opts.onComplete || function () {};
    const onError = opts.onError || function () {};

    let ws = null;
    let audioCtx = null;
    let sourceNode = null;
    let processorNode = null;
    let active = true;
    let transcriptAccum = '';

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      onError(e);
      return null;
    }

    ws.onopen = function () {
      if (!active) {
        ws.close();
        return;
      }
      // Initialize audio context and processor
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) {
        onError(new Error('AudioContext not supported'));
        return;
      }

      audioCtx = new AudioContextClass({ sampleRate: 16000 });
      sourceNode = audioCtx.createMediaStreamSource(stream);
      // 4096 buffer at 16kHz = ~256ms per chunk
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1);

      processorNode.onaudioprocess = function (e) {
        if (!active || !ws || ws.readyState !== WebSocket.OPEN) return;
        const channelData = e.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(channelData);
        const b64 = base64EncodePCM(pcm16);
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: b64
        }));
      };

      sourceNode.connect(processorNode);
      processorNode.connect(audioCtx.destination);
    };

    ws.onmessage = function (ev) {
      if (!active) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'conversation.item.input_audio_transcription.delta' && msg.delta) {
          transcriptAccum += msg.delta;
          onDelta(transcriptAccum, msg.delta);
        } else if (msg.type === 'conversation.item.input_audio_transcription.completed') {
          const final = msg.transcript || transcriptAccum;
          onComplete(final);
        }
      } catch (err) {
        // ignore parse error
      }
    };

    ws.onerror = function (ev) {
      if (active) onError(ev);
    };

    return {
      stop: function () {
        active = false;
        if (processorNode && sourceNode) {
          try { sourceNode.disconnect(); processorNode.disconnect(); } catch (e) {}
        }
        if (audioCtx) {
          try { audioCtx.close(); } catch (e) {}
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          } catch (e) {}
          setTimeout(function () {
            try { ws.close(); } catch (e) {}
          }, 300);
        }
      },
      abort: function () {
        active = false;
        if (processorNode && sourceNode) {
          try { sourceNode.disconnect(); processorNode.disconnect(); } catch (e) {}
        }
        if (audioCtx) {
          try { audioCtx.close(); } catch (e) {}
        }
        if (ws) {
          try { ws.close(); } catch (e) {}
        }
      }
    };
  }

  global.SpeechStream = {
    create: createSpeechStream
  };
})(typeof window !== 'undefined' ? window : this);
