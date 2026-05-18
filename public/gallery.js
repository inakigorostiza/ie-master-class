(() => {
  const section = document.getElementById("gallery");
  const grid = document.getElementById("gallery-grid");
  if (!section || !grid) return;

  async function load() {
    try {
      const res = await fetch("/api/public-creatives?limit=12");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      render(json.creatives ?? []);
    } catch (err) {
      console.warn("[gallery] hidden — load failed:", err);
      // Graceful degradation: hide the section entirely if the endpoint
      // fails or DB isn't reachable, rather than showing a stuck spinner.
      section.hidden = true;
    }
  }

  function render(items) {
    if (!items.length) {
      grid.innerHTML = `<p class="gallery-empty">No banners yet — be the first to fill the form above.</p>`;
      return;
    }
    const html = items
      .map((c) => {
        const w = Number(c.width) || 1200;
        const h = Number(c.height) || 628;
        return `
          <a class="gallery-item" href="${c.url}" target="_blank" rel="noopener" aria-label="Open generated banner full size">
            <img src="${c.url}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="Personalized IE banner" />
          </a>`;
      })
      .join("");
    grid.innerHTML = html;
  }

  load();
})();
