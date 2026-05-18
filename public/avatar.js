(() => {
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@heygen/liveavatar-web-sdk@0.0.18/+esm";
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // auto-end after 5 min idle to control cost

  const widget = document.getElementById("avatar-widget");
  const toggle = document.getElementById("avatar-toggle");
  const closeBtn = document.getElementById("avatar-close");
  const panel = document.getElementById("avatar-panel");
  const video = document.getElementById("avatar-video");
  const placeholder = document.getElementById("avatar-placeholder");
  const mic = document.getElementById("avatar-mic");
  const status = document.getElementById("avatar-status");
  const youSaid = document.getElementById("avatar-you");
  const assistantSaid = document.getElementById("avatar-assistant");
  const select = document.getElementById("avatar-select");

  if (!widget || !toggle || !panel || !video || !mic) return;

  const STORAGE_KEY = "ie_avatar_id";
  const messages = [];
  let avatars = [];
  let selectedAvatarId = null;
  let state = "closed";
  let sdkPromise = null;
  let session = null; // LiveAvatarSession instance
  let SessionEventConst = null;
  let AgentEventsConst = null;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordedChunks = [];
  let idleTimer = null;

  const studentName = (() => {
    try { return localStorage.getItem("ie_student_name") || null; } catch { return null; }
  })();
  const STATUS_TEXT = {
    connecting: "Connecting to advisor…",
    idle: studentName ? `Tap the mic and ask anything, ${studentName}!` : "Tap the mic and ask anything",
    listening: "Listening… tap to stop",
    transcribing: "Transcribing…",
    thinking: "Thinking…",
    speaking: "Advisor is speaking…",
    error: "Something went wrong — tap to retry",
  };

  function setState(next) {
    state = next;
    widget.dataset.avatarState = next;
    if (status && STATUS_TEXT[next]) status.textContent = STATUS_TEXT[next];
    mic.classList.toggle("is-recording", next === "listening");
    mic.classList.toggle("is-busy", next === "transcribing" || next === "thinking" || next === "connecting");
    mic.disabled = next === "connecting" || next === "transcribing" || next === "thinking";
  }

  function showError(message) {
    setState("error");
    if (status) status.textContent = message;
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state !== "closed") {
        showError("Session ended after 5 min idle — close and reopen to restart.");
        endSession();
      }
    }, IDLE_TIMEOUT_MS);
  }

  async function loadSDK() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).catch((err) => {
        sdkPromise = null;
        throw err;
      });
    }
    return sdkPromise;
  }

  async function startSession() {
    setState("connecting");
    if (placeholder) placeholder.hidden = false;
    try {
      const mod = await loadSDK();
      const { LiveAvatarSession, SessionEvent, AgentEventsEnum } = mod;
      SessionEventConst = SessionEvent;
      AgentEventsConst = AgentEventsEnum;

      const chosen = avatars.find((a) => a.id === selectedAvatarId) ?? avatars[0];
      const tokenRes = await fetch("/api/heygen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          chosen
            ? { avatar_id: chosen.id, voice_id: chosen.voice_id, context_id: chosen.context_id }
            : {},
        ),
      });
      const tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenJson.token) {
        const upstream = tokenJson.upstream || tokenJson.error || `token ${tokenRes.status}`;
        if (typeof upstream === "string" && upstream.includes("not supported in sandbox")) {
          throw new Error(
            `"${chosen?.name ?? "This avatar"}" requires live mode. Pick Wayne or switch off sandbox.`,
          );
        }
        throw new Error(upstream);
      }

      session = new LiveAvatarSession(tokenJson.token, { voiceChat: false });

      let attached = false;
      const tryAttach = () => {
        if (attached || !session || !video) return;
        const videoTrack = session._remoteVideoTrack;
        const audioTrack = session._remoteAudioTrack;
        if (!videoTrack) return;

        try {
          // Use LiveKit's canonical attach — it manages srcObject and play() correctly.
          videoTrack.attach(video);
          if (audioTrack && typeof audioTrack.attach === "function") {
            audioTrack.attach(video);
          }
          attached = true;
          console.log(
            "[avatar] tracks attached — video:", !!videoTrack,
            "audio:", !!audioTrack,
            "video.srcObject:", !!video.srcObject,
            "tracks on stream:", video.srcObject?.getTracks?.().length ?? 0,
          );

          video.muted = false;
          video.play()
            .then(() => console.log("[avatar] play() resolved — paused:", video.paused))
            .catch((err) => {
              console.warn("[avatar] unmuted play blocked, retrying muted:", err);
              video.muted = true;
              video.play()
                .then(() => console.log("[avatar] muted play resolved"))
                .catch((e2) => console.error("[avatar] play failed:", e2));
            });

          // Diagnostic snapshot 2s later — confirms whether frames are flowing.
          setTimeout(() => {
            console.log(
              "[avatar] 2s diag — videoWidth:", video.videoWidth,
              "videoHeight:", video.videoHeight,
              "paused:", video.paused,
              "readyState:", video.readyState,
              "currentTime:", video.currentTime,
            );
          }, 2000);

          if (placeholder) placeholder.hidden = true;
          if (state === "connecting") setState("idle");
          resetIdleTimer();
        } catch (err) {
          console.warn("[avatar] tryAttach error:", err);
        }
      };

      session.on(SessionEvent.SESSION_STREAM_READY, tryAttach);

      session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
        console.warn("[avatar] disconnected:", reason);
        if (state !== "closed") showError("Connection ended. Close and reopen to retry.");
        cleanupAvatar();
      });

      if (AgentEventsEnum) {
        session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
          tryAttach();
          setState("speaking");
        });
        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
          if (state !== "closed") setState("idle");
          resetIdleTimer();
        });
      }

      await session.start();

      // Some sessions don't emit SESSION_STREAM_READY reliably. Poll attach()
      // for up to 10s after start() resolves — it no-ops once attached.
      let attempts = 0;
      const pollId = setInterval(() => {
        attempts += 1;
        tryAttach();
        if (attached || attempts >= 20 || state === "closed") {
          clearInterval(pollId);
        }
      }, 500);
    } catch (err) {
      console.error("[avatar] start error:", err);
      showError(err?.message || "Couldn't connect to the avatar service.");
      cleanupAvatar();
    }
  }

  function cleanupAvatar() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (video) {
      try {
        video.pause();
      } catch {}
      video.srcObject = null;
    }
    if (placeholder) placeholder.hidden = false;
    session = null;
  }

  async function endSession() {
    if (session) {
      try {
        await session.stop();
      } catch (err) {
        console.warn("[avatar] stop:", err);
      }
    }
    cleanupAvatar();
  }

  async function openPanel() {
    if (state !== "closed") return;
    widget.dataset.state = "open";
    toggle.setAttribute("aria-label", "Close avatar advisor");
    await loadAvatars();
    startSession();
  }

  async function closePanel() {
    widget.dataset.state = "closed";
    toggle.setAttribute("aria-label", "Open avatar advisor");
    stopRecording(true);
    await endSession();
    state = "closed";
    widget.dataset.avatarState = "closed";
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
      console.error("[avatar] mic denied:", err);
      showError("Mic access was blocked. Allow microphone permission to use voice.");
      return;
    }

    const mime = pickMime();
    try {
      mediaRecorder = mime
        ? new MediaRecorder(mediaStream, { mimeType: mime })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      console.error("[avatar] MediaRecorder failed:", err);
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
    resetIdleTimer();
  }

  function stopRecording(silent = false) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (!silent) setState("transcribing");
  }

  async function handleAudioBlob(blob) {
    if (!blob || blob.size < 200) {
      showError("Didn't catch any audio — tap to try again.");
      return;
    }
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `transcribe ${res.status}`);
      const text = (data.text ?? "").trim();
      if (!text) {
        showError("Didn't catch what you said — tap to try again.");
        return;
      }
      if (youSaid) {
        const esc = window.IEMarkdown ? window.IEMarkdown.escapeHtml(text) : text;
        youSaid.innerHTML = `<span class="avatar-line-label">You:</span> ${esc}`;
      }
      if (assistantSaid) assistantSaid.innerHTML = "";
      await askAndSpeak(text);
    } catch (err) {
      console.error("[avatar] transcribe error:", err);
      showError("Couldn't transcribe that — tap to try again.");
    }
  }

  async function askAndSpeak(userText) {
    messages.push({ role: "user", content: userText });
    setState("thinking");
    resetIdleTimer();

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
                assistantSaid.innerHTML = `<span class="avatar-line-label">Advisor:</span> ${body}`;
              }
            } else if (data.type === "error") {
              throw new Error(data.message || "Unknown error");
            }
          }
        }
      }

      if (!acc.trim()) throw new Error("Empty response from advisor");
      messages.push({ role: "assistant", content: acc });

      if (session) {
        try {
          // Strip URLs + markdown markers so the avatar doesn't spell out raw
          // links character-by-character. The on-screen "Advisor:" transcript
          // still shows the original markdown above.
          const spoken = window.IEMarkdown?.toSpeech?.(acc) ?? acc;
          if (spoken.trim()) {
            // `repeat` sends an avatar.speak_text command — say this exact text, no HeyGen LLM.
            session.repeat(spoken);
          }
        } catch (err) {
          console.error("[avatar] repeat error:", err);
          showError("Avatar couldn't speak — but you can read the answer above.");
        }
      }
      resetIdleTimer();
    } catch (err) {
      console.error("[avatar] chat error:", err);
      messages.pop();
      showError("The advisor didn't respond — tap to try again.");
    }
  }

  async function loadAvatars() {
    if (avatars.length > 0) return; // already loaded
    try {
      const res = await fetch("/api/heygen");
      const json = await res.json().catch(() => ({}));
      avatars = Array.isArray(json.avatars) ? json.avatars : [];
    } catch (err) {
      console.warn("[avatar] avatars list error:", err);
      avatars = [];
    }
    if (!avatars.length) {
      // Backend should always include Wayne, but harden against an empty response.
      avatars = [{ id: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", name: "Wayne", voice_id: null, context_id: null }];
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    selectedAvatarId = avatars.some((a) => a.id === stored) ? stored : avatars[0].id;

    if (select) {
      select.innerHTML = "";
      const groups = [
        { source: "default", label: "Default (sandbox-ready)" },
        { source: "custom", label: "Your avatars" },
        { source: "public", label: "Public — live mode only" },
      ];
      for (const { source, label } of groups) {
        const items = avatars.filter((a) => a.source === source);
        if (!items.length) continue;
        const grp = document.createElement("optgroup");
        grp.label = label;
        for (const a of items) {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name;
          if (a.id === selectedAvatarId) opt.selected = true;
          grp.appendChild(opt);
        }
        select.appendChild(grp);
      }
    }
  }

  async function onAvatarChange() {
    if (!select) return;
    const newId = select.value;
    if (newId === selectedAvatarId) return;
    selectedAvatarId = newId;
    localStorage.setItem(STORAGE_KEY, newId);
    if (state !== "closed") {
      // Restart the session with the new avatar.
      await endSession();
      state = "closed";
      widget.dataset.avatarState = "closed";
      startSession();
    }
  }

  if (select) {
    select.addEventListener("change", onAvatarChange);
  }

  toggle.addEventListener("click", () => {
    if (widget.dataset.state === "open") closePanel();
    else openPanel();
  });

  closeBtn?.addEventListener("click", closePanel);

  mic.addEventListener("click", () => {
    if (state === "idle" || state === "error") startRecording();
    else if (state === "listening") stopRecording();
  });

  window.addEventListener("beforeunload", () => {
    if (session) {
      try {
        session.stop();
      } catch {}
    }
  });

  window.IEAvatar = { open: openPanel, close: closePanel };
})();
