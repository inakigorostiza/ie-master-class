// Minimal, safe markdown renderer for assistant output.
// Strategy: HTML-escape everything first, then apply markdown transforms on
// the escaped text so no raw HTML or javascript: URLs can sneak through.
(() => {
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeHref(url) {
    return /^(https?:|mailto:)/i.test(url) ? url : "";
  }

  function renderInline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `~~~IEICODE${codes.length - 1}~~~`;
    });

    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (m, text, url) => {
      const href = safeHref(url);
      if (!href) return m;
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    });

    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");

    s = s.replace(
      /(^|[^"=>])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,
      (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`,
    );

    s = s.replace(/~~~IEICODE(\d+)~~~/g, (_, i) => `<code>${codes[parseInt(i, 10)]}</code>`);
    return s;
  }

  function renderBlock(block) {
    if (!block.trim()) return "";

    // Horizontal rule — a line that's only --- or *** or ___ (3+ chars)
    if (/^\s*([-*_])\1{2,}\s*$/.test(block)) {
      return "<hr>";
    }

    // Heading line — handle even if more content follows on next lines
    // (Claude often emits "### Title\ncontent..." without a blank line between.)
    const hLine = block.match(/^(#{1,6})\s+(.+)/);
    if (hLine) {
      const newlineIdx = block.indexOf("\n");
      const headingText = newlineIdx === -1 ? hLine[2] : block.slice(hLine[1].length + 1, newlineIdx);
      const level = Math.min(hLine[1].length + 2, 6);
      const headingHtml = `<h${level}>${renderInline(headingText.trim())}</h${level}>`;
      const rest = newlineIdx === -1 ? "" : block.slice(newlineIdx + 1);
      return rest.trim() ? headingHtml + renderBlock(rest) : headingHtml;
    }

    const lines = block.split("\n");

    // Blockquote — every line starts with "> " (post-escape: "&gt;")
    if (lines.every((l) => /^\s*&gt;\s?/.test(l))) {
      const inner = lines.map((l) => l.replace(/^\s*&gt;\s?/, "")).join("\n");
      return `<blockquote>${renderInline(inner).replace(/\n/g, "<br>")}</blockquote>`;
    }

    if (lines.every((l) => /^\s*[-*+]\s+\S/.test(l))) {
      const items = lines
        .map((l) => l.replace(/^\s*[-*+]\s+/, ""))
        .map((i) => `<li>${renderInline(i)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }

    if (lines.every((l) => /^\s*\d+\.\s+\S/.test(l))) {
      const items = lines
        .map((l) => l.replace(/^\s*\d+\.\s+/, ""))
        .map((i) => `<li>${renderInline(i)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }

    // Handle a block where some lines are --- (treat as inline hr split)
    if (lines.some((l) => /^\s*([-*_])\1{2,}\s*$/.test(l))) {
      const parts = [];
      let buf = [];
      const flush = () => {
        if (buf.length) {
          parts.push(`<p>${renderInline(buf.join("\n")).replace(/\n/g, "<br>")}</p>`);
          buf = [];
        }
      };
      for (const l of lines) {
        if (/^\s*([-*_])\1{2,}\s*$/.test(l)) {
          flush();
          parts.push("<hr>");
        } else {
          buf.push(l);
        }
      }
      flush();
      return parts.join("");
    }

    return `<p>${renderInline(block).replace(/\n/g, "<br>")}</p>`;
  }

  function render(md) {
    if (md == null || md === "") return "";
    let text = String(md).replace(/\r\n?/g, "\n").replace(/\n+$/, "");

    const fences = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      fences.push(code);
      return `~~~IEFENCE${fences.length - 1}~~~`;
    });

    text = escapeHtml(text);

    const blocks = text.split(/\n{2,}/);
    let html = blocks.map(renderBlock).filter(Boolean).join("");

    html = html.replace(/~~~IEFENCE(\d+)~~~/g, (_, i) => {
      return `<pre><code>${escapeHtml(fences[parseInt(i, 10)].replace(/\n$/, ""))}</code></pre>`;
    });

    return html;
  }

  // Strip URLs + markdown markers so TTS / lip-sync engines read clean prose
  // instead of spelling out "h-t-t-p-s colon slash slash w-w-w dot…".
  function toSpeech(md) {
    if (!md) return "";
    let s = String(md).replace(/\r\n?/g, "\n");
    // Fenced + indented code blocks — drop entirely.
    s = s.replace(/```[\s\S]*?```/g, " ");
    // Markdown links: [label](url) → label.
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // Bare URLs (http/https/ftp/www).
    s = s.replace(/\b(?:https?|ftp):\/\/\S+/gi, " ");
    s = s.replace(/\bwww\.\S+/gi, " ");
    // Bold / italic markers, inline code.
    s = s.replace(/(\*\*|__)([^*_\n]+?)\1/g, "$2");
    s = s.replace(/(?<![*_])([*_])([^*_\n]+?)\1(?![*_])/g, "$2");
    s = s.replace(/`([^`]+)`/g, "$1");
    // Headings, blockquote arrows, bullet markers.
    s = s.replace(/^#{1,6}\s+/gm, "");
    s = s.replace(/^\s*>\s?/gm, "");
    s = s.replace(/^\s*[-*+]\s+/gm, "");
    s = s.replace(/^\s*\d+\.\s+/gm, "");
    // Horizontal rules.
    s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");
    // Dangling em-dash that used to lead into a URL ("Foo — https://…").
    s = s.replace(/—\s*(\s|$)/g, " ");
    // Paragraph breaks → sentence pauses.
    s = s.replace(/\n{2,}/g, ". ");
    s = s.replace(/\s+/g, " ").trim();
    // Avoid double punctuation like ". ."
    s = s.replace(/([.!?])\s*\./g, "$1");
    return s;
  }

  window.IEMarkdown = { render, escapeHtml, toSpeech };
})();
