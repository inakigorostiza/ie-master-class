(() => {
  const STORAGE_KEY = "ie_admin_token";

  const tokenInput = document.getElementById("studio-token");
  const refreshBtn = document.getElementById("studio-refresh");
  const filterInput = document.getElementById("studio-filter");
  const summaryEl = document.getElementById("studio-summary");
  const statusEl = document.getElementById("studio-status");
  const tableEl = document.getElementById("studio-table");
  const tbody = document.getElementById("studio-tbody");
  const modal = document.getElementById("studio-modal");
  const modalTitle = document.getElementById("studio-modal-title");
  const modalBody = document.getElementById("studio-modal-body");
  const modalClose = document.getElementById("studio-modal-close");

  let students = [];

  tokenInput.value = localStorage.getItem(STORAGE_KEY) ?? "";
  tokenInput.addEventListener("change", () => {
    localStorage.setItem(STORAGE_KEY, tokenInput.value.trim());
    loadStudents();
  });
  refreshBtn.addEventListener("click", loadStudents);
  filterInput.addEventListener("input", renderTable);
  modalClose.addEventListener("click", () => modal.close());

  document.addEventListener("DOMContentLoaded", loadStudents);
  if (document.readyState !== "loading") loadStudents();

  async function loadStudents() {
    const token = tokenInput.value.trim();
    if (!token) {
      setStatus("Paste your admin token to load students.", "warn");
      tableEl.hidden = true;
      return;
    }
    setStatus("Loading students…", "pending");
    try {
      const res = await fetch("/api/admin?action=students&limit=200", {
        headers: { "x-admin-token": token },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      students = json.students ?? [];
      tableEl.hidden = students.length === 0;
      setStatus(students.length ? "" : "No students yet.", students.length ? null : "warn");
      summaryEl.textContent = `${students.length} student${students.length === 1 ? "" : "s"}`;
      renderTable();
    } catch (err) {
      console.error(err);
      setStatus(err.message, "error");
      tableEl.hidden = true;
    }
  }

  function renderTable() {
    const q = filterInput.value.trim().toLowerCase();
    const rows = q
      ? students.filter((s) =>
          [s.full_name, s.email, s.country, s.city, s.career_goal_one_line]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(q)),
        )
      : students;

    tbody.innerHTML = "";
    for (const s of rows) {
      const tr = document.createElement("tr");
      tr.dataset.email = s.email;
      tr.innerHTML = `
        <td class="studio-photo">
          ${
            s.profile_picture_url
              ? `<img src="${s.profile_picture_url}" alt="" loading="lazy" />`
              : `<span class="studio-initials">${initials(s.full_name)}</span>`
          }
        </td>
        <td>
          <div class="studio-name">${escapeHtml(s.full_name ?? "")}</div>
          <div class="studio-email">${escapeHtml(s.email)}</div>
          <div class="studio-meta">${escapeHtml(s.city ?? "")}${s.city && s.country ? ", " : ""}${escapeHtml(s.country ?? "")}</div>
        </td>
        <td>
          <div class="studio-goal">${escapeHtml(s.career_goal_one_line ?? "—")}</div>
          <div class="studio-meta">${escapeHtml(s.top_program_interest ?? "")}</div>
        </td>
        <td class="studio-chips">
          ${chip(s.visual_vibe)}
          ${chip(s.tone_preference)}
          ${
            Array.isArray(s.three_words)
              ? s.three_words.slice(0, 3).map((w) => chip(w, "muted")).join("")
              : ""
          }
        </td>
        <td class="studio-banner">
          ${
            s.latest_creative_url
              ? `<a href="${s.latest_creative_url}" target="_blank"><img src="${s.latest_creative_url}" alt="latest banner" /></a>`
              : `<span class="studio-empty">—</span>`
          }
          ${
            s.creatives_count > 0
              ? `<button class="studio-link" data-action="history" type="button">${s.creatives_count} total</button>`
              : ""
          }
        </td>
        <td class="studio-actions">
          <button class="studio-generate" type="button" data-action="generate-banner">
            ${s.creatives_count > 0 ? "Regenerate" : "Generate"} banner
          </button>
          <button class="studio-generate studio-generate-reel" type="button" data-action="generate-reel">
            Generate reel
          </button>
          <p class="studio-row-status" data-role="status"></p>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll("[data-action='generate-banner']").forEach((btn) => {
      btn.addEventListener("click", (e) => onGenerateBanner(e.target.closest("tr")));
    });
    tbody.querySelectorAll("[data-action='generate-reel']").forEach((btn) => {
      btn.addEventListener("click", (e) => onGenerateReel(e.target.closest("tr")));
    });
    tbody.querySelectorAll("[data-action='history']").forEach((btn) => {
      btn.addEventListener("click", (e) => onHistory(e.target.closest("tr")));
    });
  }

  async function onGenerateBanner(tr) {
    const email = tr.dataset.email;
    const btn = tr.querySelector("[data-action='generate-banner']");
    const status = tr.querySelector("[data-role='status']");
    btn.disabled = true;
    status.dataset.kind = "pending";
    status.textContent = "Generating banner… (5–20s)";
    try {
      const res = await fetch("/api/generate-creative", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": tokenInput.value.trim(),
        },
        body: JSON.stringify({ email, format: "banner" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const bannerCell = tr.querySelector(".studio-banner");
      bannerCell.innerHTML = `<a href="${json.url}" target="_blank"><img src="${json.url}" alt="latest banner" /></a>`;
      status.dataset.kind = "success";
      status.textContent = `Done in ${(json.latency_ms / 1000).toFixed(1)}s`;
      btn.textContent = "Regenerate banner";

      const s = students.find((x) => x.email === email);
      if (s) {
        s.latest_creative_url = json.url;
        s.creatives_count = (s.creatives_count ?? 0) + 1;
      }
    } catch (err) {
      console.error(err);
      status.dataset.kind = "error";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function onGenerateReel(tr) {
    const email = tr.dataset.email;
    const btn = tr.querySelector("[data-action='generate-reel']");
    const status = tr.querySelector("[data-role='status']");
    btn.disabled = true;
    status.dataset.kind = "pending";
    status.textContent = "Starting reel render… (30–120s)";
    try {
      const res = await fetch("/api/generate-creative", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": tokenInput.value.trim(),
        },
        body: JSON.stringify({ email, format: "reel" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // Poll until Veo finishes or we time out.
      const final = await pollUntilDone(json.creative_id, status);
      if (final.status === "completed" && final.url) {
        const bannerCell = tr.querySelector(".studio-banner");
        // Replace the cell content with the reel video; keep it small.
        bannerCell.innerHTML = `<a href="${final.url}" target="_blank"><video src="${final.url}" muted loop autoplay playsinline></video></a>`;
        status.dataset.kind = "success";
        status.textContent = `Reel ready (${(final.latency_ms / 1000).toFixed(1)}s)`;
        const s = students.find((x) => x.email === email);
        if (s) {
          s.latest_creative_url = final.url;
          s.creatives_count = (s.creatives_count ?? 0) + 1;
        }
      } else if (final.status === "failed") {
        throw new Error(final.error_message || "reel render failed");
      } else {
        throw new Error("reel render timed out — check history later");
      }
    } catch (err) {
      console.error(err);
      status.dataset.kind = "error";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function pollUntilDone(creativeId, statusEl) {
    const POLL_MS = 5000;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard cap
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await fetch(`/api/admin?action=poll-creative&id=${encodeURIComponent(creativeId)}`, {
        headers: { "x-admin-token": tokenInput.value.trim() },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const c = json.creative ?? {};
      if (c.status === "completed" || c.status === "failed") return c;
      if (statusEl) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        statusEl.textContent = `Rendering reel… (${elapsed}s elapsed)`;
      }
    }
    return { status: "pending" };
  }

  async function onHistory(tr) {
    const email = tr.dataset.email;
    modalTitle.textContent = `History — ${email}`;
    modalBody.innerHTML = "<p class='studio-loading'>Loading…</p>";
    modal.showModal();
    try {
      const res = await fetch(`/api/admin?action=creatives&email=${encodeURIComponent(email)}`, {
        headers: { "x-admin-token": tokenInput.value.trim() },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const items = json.creatives ?? [];
      modalBody.innerHTML = items.length
        ? items
            .map((c) => {
              const media = !c.url
                ? `<div class="studio-pending">${c.status === "pending" ? "Rendering…" : (c.error_message || "no media")}</div>`
                : (c.mime_type ?? "").startsWith("video/") || c.format === "reel"
                  ? `<a href="${c.url}" target="_blank"><video src="${c.url}" muted loop autoplay playsinline class="studio-reel-thumb"></video></a>`
                  : `<a href="${c.url}" target="_blank"><img src="${c.url}" alt="${c.format}" loading="lazy" /></a>`;
              const latency = c.latency_ms ? `${(c.latency_ms / 1000).toFixed(1)}s · ` : "";
              return `
              <figure class="studio-gallery-item">
                ${media}
                <figcaption>
                  <strong>${c.format}</strong> · ${c.width || "?"}×${c.height || "?"} ·
                  ${latency}${new Date(c.created_at).toLocaleString()}
                  ${c.status === "failed" ? `<br><span class="studio-error">${c.error_message || "failed"}</span>` : ""}
                </figcaption>
              </figure>`;
            })
            .join("")
        : `<p class="studio-empty">No creatives yet.</p>`;
    } catch (err) {
      modalBody.innerHTML = `<p class="studio-error">${err.message}</p>`;
    }
  }

  function chip(label, variant = "") {
    if (!label) return "";
    return `<span class="studio-chip ${variant}">${escapeHtml(label)}</span>`;
  }
  function initials(name) {
    return (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "•";
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function setStatus(message, kind) {
    statusEl.textContent = message ?? "";
    statusEl.dataset.kind = kind ?? "";
  }
})();
