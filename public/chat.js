(() => {
  const widget = document.getElementById("chat-widget");
  const toggle = document.getElementById("chat-toggle");
  const closeBtn = document.getElementById("chat-close");
  const list = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const suggestionsEl = document.getElementById("chat-suggestions");

  const openers = document.querySelectorAll("[data-open-chat]");
  const suggestionBtns = document.querySelectorAll("#chat-suggestions [data-suggestion]");

  const messages = [];
  let isStreaming = false;
  let greeted = false;

  const GREETING =
    "Hi! I'm IE's AI admissions advisor. Ask me anything about the 23 IE Business School master programs — formats, curriculum, careers, dual degrees, executive options, and more.";

  function setState(state) {
    widget.dataset.state = state;
    toggle.setAttribute("aria-label", state === "open" ? "Close chat" : "Open chat");
    if (state === "open") {
      if (!greeted) {
        appendMessage("assistant", GREETING);
        greeted = true;
      }
      setTimeout(() => input.focus(), 80);
    }
  }

  function openChat() {
    setState("open");
  }

  function closeChat() {
    setState("closed");
  }

  function scrollToBottom() {
    list.scrollTop = list.scrollHeight;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function linkify(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(
      /(https?:\/\/[^\s)<]+)/g,
      (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`,
    );
  }

  function appendMessage(role, text, opts = {}) {
    const li = document.createElement("li");
    li.className = `chat-msg ${role}`;
    if (opts.streaming) li.classList.add("is-streaming");
    li.innerHTML = linkify(text);
    list.appendChild(li);
    scrollToBottom();
    return li;
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  async function sendMessage(text) {
    if (isStreaming) return;
    const trimmed = (text ?? input.value).trim();
    if (!trimmed) return;

    suggestionsEl.classList.add("is-hidden");

    appendMessage("user", trimmed);
    messages.push({ role: "user", content: trimmed });
    input.value = "";
    autosize();

    isStreaming = true;
    sendBtn.disabled = true;
    const bubble = appendMessage("assistant", "", { streaming: true });
    let acc = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ messages }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Server responded ${res.status}${errBody ? `: ${errBody}` : ""}`);
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
              bubble.innerHTML = linkify(acc);
              scrollToBottom();
            } else if (data.type === "done") {
              // server signaled completion
            } else if (data.type === "error") {
              throw new Error(data.message || "Unknown error");
            }
          }
        }
      }

      bubble.classList.remove("is-streaming");
      if (acc.trim().length === 0) {
        bubble.textContent = "(no response)";
      }
      messages.push({ role: "assistant", content: acc });
    } catch (err) {
      console.error(err);
      bubble.remove();
      appendMessage(
        "assistant",
        "Sorry — something went wrong reaching the advisor. Please try again in a moment.",
      ).classList.add("error");
      messages.pop(); // drop the user turn so retry sends fresh
    } finally {
      isStreaming = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // Wire up events
  toggle.addEventListener("click", () => {
    if (widget.dataset.state === "open") {
      closeChat();
    } else {
      openChat();
    }
  });

  closeBtn.addEventListener("click", closeChat);

  openers.forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openChat();
    });
  });

  suggestionBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.suggestion;
      if (q) sendMessage(q);
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  input.addEventListener("input", autosize);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Public API for app.js
  window.IEChat = {
    open: openChat,
    close: closeChat,
    askAbout(programName) {
      openChat();
      const q = `Tell me about the ${programName}. Cover duration, format, target student profile, curriculum highlights, and typical career outcomes. Include the program URL.`;
      sendMessage(q);
    },
  };
})();
