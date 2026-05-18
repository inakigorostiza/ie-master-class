(() => {
  const form = document.getElementById("personalize-form");
  const photoInput = document.getElementById("personalize-photo-input");
  const photoPreview = document.getElementById("personalize-photo-preview");
  const programSelect = document.getElementById("personalize-program");
  const gdprCheckbox = document.getElementById("personalize-gdpr");
  const submitBtn = document.getElementById("personalize-submit");
  const statusEl = document.getElementById("personalize-status");

  if (!form || !submitBtn) return;

  const BLOB_SDK_URL = "https://cdn.jsdelivr.net/npm/@vercel/blob@1.1.1/client/+esm";
  const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // 25 MB — must match server cap
  let selectedPhoto = null;
  let photoObjectUrl = null;
  let blobSdkPromise = null;
  function loadBlobSdk() {
    if (!blobSdkPromise) blobSdkPromise = import(BLOB_SDK_URL);
    return blobSdkPromise;
  }

  // 1) Populate program dropdown from /api/programs — group dynamically so
  //    we cover whatever categories the KB declares now and in the future.
  (async () => {
    try {
      const res = await fetch("/api/programs");
      const programs = await res.json();
      if (!Array.isArray(programs)) throw new Error("bad programs payload");
      programSelect.innerHTML = '<option value="">Select…</option>';

      // Map raw KB categories → friendly optgroup labels. Anything with a
      // "dual-" prefix collapses into one "Dual degrees" group; anything
      // else uses its own label. We also pull Executive masters out by name
      // so they get their own group.
      const groups = new Map(); // label → items[]
      const labelFor = (p) => {
        if (/^executive\b/i.test(p.name)) return "Executive";
        if (typeof p.category === "string" && p.category.startsWith("dual")) {
          return "Dual degrees";
        }
        if (p.category === "standalone") return "Standalone masters";
        return p.category || "Other programs";
      };
      for (const p of programs) {
        const label = labelFor(p);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(p);
      }

      // Stable preferred order; unknown labels appended at the end.
      const order = ["Standalone masters", "Executive", "Dual degrees"];
      const sortedKeys = [
        ...order.filter((k) => groups.has(k)),
        ...[...groups.keys()].filter((k) => !order.includes(k)).sort(),
      ];

      for (const label of sortedKeys) {
        const items = groups.get(label).slice().sort((a, b) => a.name.localeCompare(b.name));
        const grp = document.createElement("optgroup");
        grp.label = `${label} (${items.length})`;
        for (const p of items) {
          const opt = document.createElement("option");
          opt.value = p.slug;
          opt.textContent = p.name;
          grp.appendChild(opt);
        }
        programSelect.appendChild(grp);
      }
    } catch (err) {
      console.warn("[personalize] could not load programs:", err);
      programSelect.innerHTML = '<option value="">Not available — leave blank</option>';
    }
  })();

  // 2) Photo input → preview + size guard
  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) {
      selectedPhoto = null;
      return;
    }
    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file (JPG, PNG, WebP).", "error");
      photoInput.value = "";
      selectedPhoto = null;
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setStatus("Photo is larger than 25 MB — pick a smaller one.", "error");
      photoInput.value = "";
      selectedPhoto = null;
      return;
    }
    selectedPhoto = file;
    setStatus("", null);
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = URL.createObjectURL(file);
    photoPreview.innerHTML = `<img src="${photoObjectUrl}" alt="Profile preview" />`;
  });

  // 3) GDPR toggles submit
  gdprCheckbox.addEventListener("change", () => {
    submitBtn.disabled = !gdprCheckbox.checked;
  });

  // 4) Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!gdprCheckbox.checked) return;

    submitBtn.disabled = true;
    setStatus("Sending…", "pending");

    try {
      let profilePictureUrl = null;
      if (selectedPhoto) {
        setStatus("Uploading photo…", "pending");
        // Direct client upload to Vercel Blob — bypasses Vercel's 4.5MB function body limit.
        const { upload } = await loadBlobSdk();
        const ext = (selectedPhoto.name.split(".").pop() || "jpg").toLowerCase();
        const filename = `personalize/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const newBlob = await upload(filename, selectedPhoto, {
          access: "public",
          handleUploadUrl: "/api/upload-photo",
          contentType: selectedPhoto.type,
          onUploadProgress: ({ percentage }) => {
            setStatus(`Uploading photo… ${Math.round(percentage)}%`, "pending");
          },
        });
        profilePictureUrl = newBlob.url;
      }

      setStatus("Saving your profile…", "pending");

      const payload = collectPayload();
      if (profilePictureUrl) payload.profile_picture_url = profilePictureUrl;

      const res = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `personalize ${res.status}`);

      // Persist identity bits so chat / voice / avatar widgets can personalize
      // instantly without an extra round-trip. Email also enables Claude-side
      // profile injection in /api/chat.
      try {
        if (payload.email) {
          localStorage.setItem("ie_student_email", payload.email.toLowerCase().trim());
        }
        const first = (payload.full_name ?? "").trim().split(/\s+/)[0] ?? "";
        if (first) localStorage.setItem("ie_student_name", first);
        if (payload.tone_preference) localStorage.setItem("ie_student_tone", payload.tone_preference);
      } catch {}

      setStatus(
        `Thanks ${payload.full_name?.split(" ")[0] ?? ""} — we'll be in touch with your tailored recommendations.`,
        "success",
      );
      form.reset();
      submitBtn.disabled = true;
      photoPreview.innerHTML = `<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" /></svg>`;
      if (photoObjectUrl) {
        URL.revokeObjectURL(photoObjectUrl);
        photoObjectUrl = null;
      }
      selectedPhoto = null;
    } catch (err) {
      console.error("[personalize] submit error:", err);
      setStatus(err.message || "Something went wrong — try again in a moment.", "error");
      submitBtn.disabled = !gdprCheckbox.checked;
    }
  });

  function collectPayload() {
    const fd = new FormData(form);
    const payload = {};
    for (const [key, value] of fd.entries()) {
      if (key === "photo") continue; // photo is handled separately
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      payload[key] = trimmed;
    }
    payload.gdpr_consent = !!gdprCheckbox.checked;

    // Combine three_words_* into an array for cleaner downstream use
    const words = [payload.three_words_1, payload.three_words_2, payload.three_words_3]
      .filter((w) => typeof w === "string" && w.trim().length);
    if (words.length) payload.three_words = words;
    delete payload.three_words_1;
    delete payload.three_words_2;
    delete payload.three_words_3;

    if (payload.years_experience) {
      const n = Number(payload.years_experience);
      if (!Number.isNaN(n)) payload.years_experience = n;
    }

    return payload;
  }

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind ?? "";
  }
})();
