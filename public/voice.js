(() => {
  const widget = document.getElementById("voice-widget");
  const toggle = document.getElementById("voice-toggle");
  const closeBtn = document.getElementById("voice-close");
  const panel = document.getElementById("voice-panel");
  const mic = document.getElementById("voice-mic");
  const status = document.getElementById("voice-status");
  const youSaid = document.getElementById("voice-you");
  const assistantSaid = document.getElementById("voice-assistant");
  const audio = document.getElementById("voice-audio");
  const select = document.getElementById("voice-select");

  if (!widget || !toggle || !panel || !mic || !audio) return;

  const STORAGE_KEY = "ie_voice_id";
  const messages = [];
  let voices = [];
  let selectedVoiceId = localStorage.getItem(STORAGE_KEY) || null;
  let state = "idle"; // idle | listening | transcribing | thinking | speaking | error
  let mediaRecorder = null;
  let mediaStream = null;
  let recordedChunks = [];
  let ttsAbort = null;
  let currentObjectUrl = null;

  const studentName = (() => {
    try { return localStorage.getItem("ie_student_name") || null; } catch { return null; }
  })();
  const STATUS_TEXT = {
    idle: studentName ? `Tap the mic and ask anything, ${studentName}!` : "Tap the mic and ask anything",
    listening: "Listening… tap to stop",
    transcribing: "Transcribing…",
    thinking: "Thinking…",
    speaking: "Speaking… tap to stop",
    error: "Something went wrong — tap to try again",
  };

  function setState(next) {
    state = next;
    widget.dataset.voiceState = next;
    mic.dataset.state = next;
    if (status) status.textContent = STATUS_TEXT[next] ?? "";
    const recording = next === "listening";
    const busy = next === "transcribing" || next === "thinking";
    mic.classList.toggle("is-recording", recording);
    mic.classList.toggle("is-busy", busy);
    mic.disabled = busy;
    mic.setAttribute(
      "aria-label",
      recording ? "Stop recording" : next === "speaking" ? "Stop playback" : "Start recording",
    );
  }

  function openPanel() {
    widget.dataset.state = "open";
    toggle.setAttribute("aria-label", "Close voice advisor");
    if (state === "idle") setState("idle");
    loadVoices();
  }

  async function loadVoices() {
    if (voices.length > 0 || !select) return;
    try {
      const res = await fetch("/api/elevenlabs-voices");
      const json = await res.json().catch(() => ({}));
      voices = Array.isArray(json.voices) ? json.voices : [];
    } catch (err) {
      console.warn("[voice] voices list error:", err);
      voices = [];
    }

    if (!voices.length) {
      select.innerHTML = '<option value="">(no voices)</option>';
      select.disabled = true;
      return;
    }

    if (!voices.some((v) => v.id === selectedVoiceId)) {
      selectedVoiceId = voices[0].id;
    }

    select.innerHTML = "";
    select.disabled = false;
    const groupOrder = ["cloned", "generated", "professional", "premade"];
    const groupLabels = {
      cloned: "Your voices",
      generated: "Generated",
      professional: "Professional",
      premade: "Premade",
    };
    for (const cat of groupOrder) {
      const items = voices.filter((v) => v.category === cat);
      if (!items.length) continue;
      const grp = document.createElement("optgroup");
      grp.label = groupLabels[cat] ?? cat;
      for (const v of items) {
        const opt = document.createElement("option");
        opt.value = v.id;
        const accent = v.labels?.accent ? ` · ${v.labels.accent}` : "";
        opt.textContent = `${v.name}${accent}`;
        if (v.id === selectedVoiceId) opt.selected = true;
        grp.appendChild(opt);
      }
      select.appendChild(grp);
    }
  }

  function onVoiceChange() {
    if (!select) return;
    const id = select.value;
    if (!id || id === selectedVoiceId) return;
    selectedVoiceId = id;
    localStorage.setItem(STORAGE_KEY, id);
  }

  function closePanel() {
    widget.dataset.state = "closed";
    toggle.setAttribute("aria-label", "Open voice advisor");
    stopEverything();
  }

  function stopEverything() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch {}
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (ttsAbort) {
      ttsAbort.abort();
      ttsAbort = null;
    }
    if (!audio.paused) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    setState("idle");
  }

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("This browser does not support microphone capture.");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("[voice] mic permission denied:", err);
      showError("Mic access was blocked. Allow microphone permission in your browser to use voice.");
      return;
    }

    const mime = pickMime();
    try {
      mediaRecorder = mime
        ? new MediaRecorder(mediaStream, { mimeType: mime })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      console.error("[voice] MediaRecorder failed:", err);
      showError("Could not start recording in this browser.");
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      return;
    }

    recordedChunks = [];
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const tracks = mediaStream?.getTracks() ?? [];
      tracks.forEach((t) => t.stop());
      mediaStream = null;
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      handleAudioBlob(blob);
    });

    mediaRecorder.start();
    setState("listening");
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    setState("transcribing");
  }

  async function handleAudioBlob(blob) {
    if (!blob || blob.size < 200) {
      showError("Didn't catch any audio — try again.");
      return;
    }
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `transcribe ${res.status}`);
      }
      const text = (data.text ?? "").trim();
      if (!text) {
        showError("Didn't catch what you said — try again.");
        return;
      }
      if (youSaid) {
        const esc = window.IEMarkdown ? window.IEMarkdown.escapeHtml(text) : text;
        youSaid.innerHTML = `<span class="voice-line-label">You:</span> ${esc}`;
      }
      if (assistantSaid) assistantSaid.innerHTML = "";
      await askAndSpeak(text);
    } catch (err) {
      console.error("[voice] transcribe error:", err);
      showError("Couldn't transcribe that — please try again.");
    }
  }

  async function askAndSpeak(userText) {
    messages.push({ role: "user", content: userText });
    setState("thinking");

    let acc = "";
    try {
      const studentEmail = (() => {
        try { return localStorage.getItem("ie_student_email") || null; } catch { return null; }
      })();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ messages, student_email: studentEmail }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`chat ${res.status}${errBody ? `: ${errBody}` : ""}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let data;
            try {
              data = JSON.parse(payload);
            } catch {
              continue;
            }
            if (data.type === "delta" && typeof data.text === "string") {
              acc += data.text;
              if (assistantSaid) {
                const body = window.IEMarkdown ? window.IEMarkdown.render(acc) : acc;
                assistantSaid.innerHTML = `<span class="voice-line-label">Advisor:</span> ${body}`;
              }
            } else if (data.type === "error") {
              throw new Error(data.message || "Unknown error");
            }
          }
        }
      }

      if (!acc.trim()) {
        throw new Error("Empty response from advisor");
      }
      messages.push({ role: "assistant", content: acc });
      // Strip URLs + markdown markers so TTS doesn't spell out raw links.
      const spoken = window.IEMarkdown?.toSpeech?.(acc) ?? acc;
      if (spoken.trim()) await speak(spoken);
    } catch (err) {
      console.error("[voice] chat error:", err);
      messages.pop(); // drop the user turn so retry is fresh
      showError("The advisor didn't respond — please try again.");
    }
  }

  async function speak(text) {
    if (ttsAbort) ttsAbort.abort();
    ttsAbort = new AbortController();
    setState("speaking");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedVoiceId ? { text, voice_id: selectedVoiceId } : { text }),
        signal: ttsAbort.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`tts ${res.status}${errBody ? `: ${errBody}` : ""}`);
      }
      const blob = await res.blob();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(blob);
      audio.src = currentObjectUrl;
      audio.onended = () => {
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
          currentObjectUrl = null;
        }
        if (state === "speaking") setState("idle");
      };
      await audio.play();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[voice] tts error:", err);
      showError("Couldn't play the response audio — but you can read it above.");
    }
  }

  function showError(message) {
    setState("error");
    if (status) status.textContent = message;
    setTimeout(() => {
      if (state === "error") setState("idle");
    }, 4000);
  }

  // Wire up events
  if (select) {
    select.addEventListener("change", onVoiceChange);
  }

  toggle.addEventListener("click", () => {
    if (widget.dataset.state === "open") closePanel();
    else openPanel();
  });

  closeBtn?.addEventListener("click", closePanel);

  mic.addEventListener("click", () => {
    if (state === "idle" || state === "error") {
      startRecording();
    } else if (state === "listening") {
      stopRecording();
    } else if (state === "speaking") {
      stopEverything();
    }
  });

  // Public API for any future CTA buttons
  window.IEVoice = {
    open: openPanel,
    close: closePanel,
  };

  setState("idle");
})();
