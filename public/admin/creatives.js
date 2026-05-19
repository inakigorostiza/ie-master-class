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

  const bulkToolbar = document.getElementById("studio-bulk-toolbar");
  const bulkCountEl = document.getElementById("studio-bulk-count-value");
  const bulkBannerBtn = document.getElementById("studio-bulk-banner");
  const bulkReelBtn = document.getElementById("studio-bulk-reel");
  const bulkRemoveBtn = document.getElementById("studio-bulk-remove");
  const bulkProgressEl = document.getElementById("studio-bulk-progress");
  const selectAllEl = document.getElementById("studio-select-all");

  let students = [];
  const selected = new Set();
  let bulkRunning = false;

  tokenInput.value = localStorage.getItem(STORAGE_KEY) ?? "";
  tokenInput.addEventListener("change", () => {
    localStorage.setItem(STORAGE_KEY, tokenInput.value.trim());
    loadStudents();
  });
  refreshBtn.addEventListener("click", loadStudents);
  filterInput.addEventListener("input", renderTable);
  modalClose.addEventListener("click", () => modal.close());

  selectAllEl.addEventListener("change", onSelectAllChange);
  bulkBannerBtn.addEventListener("click", () => runBulk("banner"));
  bulkReelBtn.addEventListener("click", () => runBulk("reel"));
  bulkRemoveBtn.addEventListener("click", () => runBulk("remove"));


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
      const isChecked = selected.has(s.email);
      tr.innerHTML = `
        <td class="studio-checkbox-cell">
          <input type="checkbox" data-bulk-select aria-label="Select ${escapeHtml(s.email)}" ${isChecked ? "checked" : ""} />
        </td>
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
          <button class="studio-row-remove" type="button" data-action="remove-lead">Remove</button>
          ${renderSendButtons(s)}
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
    tbody.querySelectorAll("[data-action='remove-lead']").forEach((btn) => {
      btn.addEventListener("click", (e) => onRemoveLead(e.target.closest("tr")));
    });
    tbody.querySelectorAll("[data-action^='send-']").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const channel = e.currentTarget.dataset.action.replace("send-", "");
        onSendMessage(e.currentTarget.closest("tr"), channel);
      });
    });
    tbody.querySelectorAll("[data-bulk-select]").forEach((cb) => {
      cb.addEventListener("change", onRowCheckboxChange);
    });
    syncBulkUI();
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
    modalBody.dataset.email = email;
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
              <figure class="studio-gallery-item" data-creative-id="${escapeHtml(c.id)}" data-creative-url="${escapeHtml(c.url ?? "")}">
                ${media}
                <figcaption>
                  <strong>${c.format}</strong> · ${c.width || "?"}×${c.height || "?"} ·
                  ${latency}${new Date(c.created_at).toLocaleString()}
                  ${c.status === "failed" ? `<br><span class="studio-error">${c.error_message || "failed"}</span>` : ""}
                </figcaption>
                <button class="studio-creative-remove" type="button" data-action="delete-creative" aria-label="Delete this creative">Delete</button>
              </figure>`;
            })
            .join("")
        : `<p class="studio-empty">No creatives yet.</p>`;

      modalBody.querySelectorAll("[data-action='delete-creative']").forEach((btn) => {
        btn.addEventListener("click", (e) => onDeleteCreative(e.target.closest("figure")));
      });
    } catch (err) {
      modalBody.innerHTML = `<p class="studio-error">${err.message}</p>`;
    }
  }

  async function onDeleteCreative(figure) {
    if (!figure) return;
    const id = figure.dataset.creativeId;
    const url = figure.dataset.creativeUrl;
    const email = modalBody.dataset.email;
    if (!id) return;
    if (!confirm("Delete this creative? The file will be removed from storage and from the public gallery.")) return;

    const btn = figure.querySelector("[data-action='delete-creative']");
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      const res = await fetch("/api/admin?action=delete-creative", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": tokenInput.value.trim(),
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      figure.remove();
      const remaining = modalBody.querySelectorAll(".studio-gallery-item").length;
      if (remaining === 0) {
        modalBody.innerHTML = `<p class="studio-empty">No creatives yet.</p>`;
      }

      const s = students.find((x) => x.email === email);
      const tr = tbody.querySelector(`tr[data-email="${cssEscape(email ?? "")}"]`);
      if (s) {
        s.creatives_count = Math.max(0, (s.creatives_count ?? 0) - 1);
        if (s.latest_creative_url === url) {
          // Best-effort: find next-most-recent URL still in the modal.
          const nextFig = modalBody.querySelector(".studio-gallery-item[data-creative-url]:not([data-creative-url=''])");
          s.latest_creative_url = nextFig?.dataset.creativeUrl || null;
        }
        if (tr) {
          const bannerCell = tr.querySelector(".studio-banner");
          if (bannerCell) {
            const u = s.latest_creative_url;
            const isVideo = u && (/\.mp4(\?|$)/i.test(u));
            bannerCell.innerHTML = u
              ? (isVideo
                  ? `<a href="${u}" target="_blank"><video src="${u}" muted loop autoplay playsinline></video></a>`
                  : `<a href="${u}" target="_blank"><img src="${u}" alt="latest banner" /></a>`)
              : `<span class="studio-empty">—</span>`;
            if (s.creatives_count > 0) {
              const histBtn = document.createElement("button");
              histBtn.className = "studio-link";
              histBtn.type = "button";
              histBtn.dataset.action = "history";
              histBtn.textContent = `${s.creatives_count} total`;
              histBtn.addEventListener("click", () => onHistory(tr));
              bannerCell.appendChild(histBtn);
            }
          }
          const bannerBtn = tr.querySelector("[data-action='generate-banner']");
          if (bannerBtn && s.creatives_count === 0) bannerBtn.textContent = "Generate banner";
        }
      }
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Delete";
      alert(`Delete failed: ${err.message}`);
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

  // ─── Bulk-select + remove ────────────────────────────────────────────────

  function onRowCheckboxChange(e) {
    const cb = e.target;
    const email = cb.closest("tr")?.dataset.email;
    if (!email) return;
    if (cb.checked) selected.add(email);
    else selected.delete(email);
    syncBulkUI();
  }

  function onSelectAllChange() {
    const visibleEmails = Array.from(tbody.querySelectorAll("tr"))
      .map((tr) => tr.dataset.email)
      .filter(Boolean);
    if (selectAllEl.checked) {
      visibleEmails.forEach((e) => selected.add(e));
    } else {
      visibleEmails.forEach((e) => selected.delete(e));
    }
    tbody.querySelectorAll("[data-bulk-select]").forEach((cb) => {
      cb.checked = selectAllEl.checked;
    });
    syncBulkUI();
  }

  function syncBulkUI() {
    const n = selected.size;
    bulkCountEl.textContent = String(n);
    bulkToolbar.hidden = n === 0;
    bulkBannerBtn.textContent = `Regenerate banner${n ? ` (${n})` : ""}`;
    bulkReelBtn.textContent = `Generate reel${n ? ` (${n})` : ""}`;
    bulkRemoveBtn.textContent = `Remove${n ? ` (${n})` : ""}`;
    const visibleEmails = Array.from(tbody.querySelectorAll("tr"))
      .map((tr) => tr.dataset.email)
      .filter(Boolean);
    selectAllEl.checked = visibleEmails.length > 0 && visibleEmails.every((e) => selected.has(e));
  }

  async function onRemoveLead(tr) {
    const email = tr.dataset.email;
    if (!email) return;
    if (!confirm(`Remove all creatives for ${email}? This deletes banners, reels, and their files. The lead profile stays.`)) return;
    const btn = tr.querySelector("[data-action='remove-lead']");
    const status = tr.querySelector("[data-role='status']");
    btn.disabled = true;
    status.dataset.kind = "pending";
    status.textContent = "Removing creatives…";
    try {
      const result = await deleteLeadCreatives(email);
      status.dataset.kind = "success";
      status.textContent = `Deleted ${result.deleted} creative${result.deleted === 1 ? "" : "s"}`;
      const bannerCell = tr.querySelector(".studio-banner");
      if (bannerCell) bannerCell.innerHTML = `<span class="studio-empty">—</span>`;
      const s = students.find((x) => x.email === email);
      if (s) {
        s.latest_creative_url = null;
        s.creatives_count = 0;
      }
      // Update the per-row banner button label.
      const bannerBtn = tr.querySelector("[data-action='generate-banner']");
      if (bannerBtn) bannerBtn.textContent = "Generate banner";
      selected.delete(email);
      syncBulkUI();
    } catch (err) {
      console.error(err);
      status.dataset.kind = "error";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteLeadCreatives(email) {
    const res = await fetch("/api/admin?action=delete-lead-creatives", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": tokenInput.value.trim(),
      },
      body: JSON.stringify({ email }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function runBulk(kind) {
    if (bulkRunning) return;
    const emails = Array.from(selected);
    if (emails.length === 0) return;

    if (kind === "remove") {
      if (!confirm(`Remove all creatives for ${emails.length} lead${emails.length === 1 ? "" : "s"}? This deletes banners, reels, and their files.`)) {
        return;
      }
    }

    bulkRunning = true;
    setBulkButtonsDisabled(true);
    let okCount = 0;
    let failCount = 0;
    const total = emails.length;
    bulkProgressEl.dataset.kind = "pending";
    bulkProgressEl.textContent = `0 of ${total}…`;

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const tr = tbody.querySelector(`tr[data-email="${cssEscape(email)}"]`);
      try {
        if (kind === "banner" && tr) {
          await onGenerateBanner(tr);
        } else if (kind === "reel" && tr) {
          await onGenerateReel(tr);
        } else if (kind === "remove") {
          if (tr) await onRemoveLead.callPath(tr);
          else await deleteLeadCreatives(email);
        }
        okCount += 1;
      } catch (err) {
        console.error("[bulk]", kind, email, err);
        failCount += 1;
      }
      bulkProgressEl.textContent = `${i + 1} of ${total}${failCount ? ` · ${failCount} failed` : ""}`;
    }

    bulkProgressEl.dataset.kind = failCount ? "error" : "success";
    bulkProgressEl.textContent = `Done · ${okCount} succeeded${failCount ? ` · ${failCount} failed` : ""}`;
    bulkRunning = false;
    setBulkButtonsDisabled(false);
  }

  function setBulkButtonsDisabled(disabled) {
    [bulkBannerBtn, bulkReelBtn, bulkRemoveBtn].forEach((b) => { b.disabled = disabled; });
  }

  // Bulk-remove path that skips the per-row confirm (we've already confirmed once for the whole batch).
  onRemoveLead.callPath = async function callPath(tr) {
    const email = tr.dataset.email;
    if (!email) return;
    const status = tr.querySelector("[data-role='status']");
    status.dataset.kind = "pending";
    status.textContent = "Removing…";
    const result = await deleteLeadCreatives(email);
    status.dataset.kind = "success";
    status.textContent = `Deleted ${result.deleted}`;
    const bannerCell = tr.querySelector(".studio-banner");
    if (bannerCell) bannerCell.innerHTML = `<span class="studio-empty">—</span>`;
    const s = students.find((x) => x.email === email);
    if (s) {
      s.latest_creative_url = null;
      s.creatives_count = 0;
    }
    const bannerBtn = tr.querySelector("[data-action='generate-banner']");
    if (bannerBtn) bannerBtn.textContent = "Generate banner";
    selected.delete(email);
    syncBulkUI();
  };

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  // ─── Send email / WhatsApp / SMS ─────────────────────────────────────────

  function renderSendButtons(s) {
    const noCreative = !s.latest_creative_url;
    const noPhone = !s.phone_number;
    const phoneTitle = noCreative
      ? "Generate a banner or reel first"
      : noPhone
        ? "No phone number on file"
        : "";
    const emailTitle = noCreative ? "Generate a banner or reel first" : "";
    return `
      <button class="studio-send studio-send-email" type="button" data-action="send-email"
        ${noCreative ? "disabled" : ""} ${emailTitle ? `title="${emailTitle}"` : ""}>Email</button>
      <button class="studio-send studio-send-whatsapp" type="button" data-action="send-whatsapp"
        ${(noCreative || noPhone) ? "disabled" : ""} ${phoneTitle ? `title="${phoneTitle}"` : ""}>WhatsApp</button>
      <button class="studio-send studio-send-sms" type="button" data-action="send-sms"
        ${(noCreative || noPhone) ? "disabled" : ""} ${phoneTitle ? `title="${phoneTitle}"` : ""}>SMS</button>
    `;
  }

  async function onSendMessage(tr, channel) {
    if (!tr || !channel) return;
    const email = tr.dataset.email;
    const buttons = tr.querySelectorAll("[data-action^='send-']");
    const status = tr.querySelector("[data-role='status']");
    const pretty = channel === "email" ? "email" : channel === "sms" ? "SMS" : "WhatsApp";

    buttons.forEach((b) => { b.disabled = true; });
    status.dataset.kind = "pending";
    status.textContent = `Sending ${pretty}…`;

    try {
      const res = await fetch(`/api/admin?action=send-${channel}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": tokenInput.value.trim(),
        },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      status.dataset.kind = "success";
      status.textContent = `${pretty} sent ✓`;
    } catch (err) {
      console.error(err);
      status.dataset.kind = "error";
      status.textContent = `${pretty} failed: ${err.message}`;
    } finally {
      // Re-evaluate disabled state from the (possibly updated) row data.
      const s = students.find((x) => x.email === email);
      const noCreative = !s?.latest_creative_url;
      const noPhone = !s?.phone_number;
      tr.querySelectorAll("[data-action='send-email']").forEach((b) => { b.disabled = noCreative; });
      tr.querySelectorAll("[data-action='send-whatsapp'], [data-action='send-sms']").forEach((b) => {
        b.disabled = noCreative || noPhone;
      });
    }
  }
})();
