(() => {
  const section = document.getElementById("reels");
  const grid = document.getElementById("reels-grid");
  if (!section || !grid) return;

  async function load() {
    try {
      const res = await fetch("/api/public-creatives?limit=8&format=reel");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      render(json.creatives ?? []);
    } catch (err) {
      console.warn("[reels] hidden — load failed:", err);
      section.hidden = true;
    }
  }

  function render(items) {
    if (!items.length) {
      grid.innerHTML = `<p class="gallery-empty">No reels yet — generate one from the admin page.</p>`;
      return;
    }
    grid.innerHTML = items
      .map((c) => {
        const w = Number(c.width) || 720;
        const h = Number(c.height) || 1280;
        return `
          <a class="reels-item" href="${c.url}" target="_blank" rel="noopener" aria-label="Open generated reel">
            <video src="${c.url}" width="${w}" height="${h}" muted loop autoplay playsinline preload="metadata"></video>
          </a>`;
      })
      .join("");
  }

  load();
})();
