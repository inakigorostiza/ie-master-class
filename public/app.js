(() => {
  const grid = document.getElementById("program-grid");
  const filters = document.querySelectorAll(".filters .chip");

  let programs = [];
  let activeFilter = "all";

  function categoryLabel(category, slug) {
    if (slug.startsWith("dual-imba-")) return "Dual · IMBA";
    if (slug.startsWith("dual-mim-")) return "Dual · MIM";
    if (slug.startsWith("executive-")) return "Executive";
    if (category === "dual-degree") return "Dual degree";
    return "Master";
  }

  function categoryGroup(slug) {
    if (slug.startsWith("dual-")) return "dual";
    if (slug.startsWith("executive-")) return "executive";
    return "standalone";
  }

  function truncate(text, max) {
    if (!text) return "";
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }

  function renderCards() {
    grid.innerHTML = "";

    const visible = programs.filter((p) => {
      if (activeFilter === "all") return true;
      return categoryGroup(p.slug) === activeFilter;
    });

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "grid-empty";
      empty.textContent = "No programs match this filter.";
      grid.appendChild(empty);
      return;
    }

    for (const p of visible) {
      const card = document.createElement("article");
      card.className = "program-card";

      const tag = document.createElement("span");
      tag.className = "program-tag";
      tag.textContent = categoryLabel(p.category, p.slug);

      const h3 = document.createElement("h3");
      h3.textContent = p.name;

      const desc = document.createElement("p");
      desc.textContent = truncate(p.overview, 220);

      const actions = document.createElement("div");
      actions.className = "program-actions";

      const askBtn = document.createElement("button");
      askBtn.type = "button";
      askBtn.className = "ask-btn";
      askBtn.textContent = "Ask about this program";
      askBtn.addEventListener("click", () => {
        if (window.IEChat && typeof window.IEChat.askAbout === "function") {
          window.IEChat.askAbout(p.name);
        }
      });

      const link = document.createElement("a");
      link.className = "link-out";
      link.href = p.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View on ie.edu ↗";

      actions.appendChild(askBtn);
      actions.appendChild(link);

      card.appendChild(tag);
      card.appendChild(h3);
      card.appendChild(desc);
      card.appendChild(actions);

      grid.appendChild(card);
    }
  }

  filters.forEach((btn) => {
    btn.addEventListener("click", () => {
      filters.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      activeFilter = btn.dataset.filter || "all";
      renderCards();
    });
  });

  fetch("/api/programs")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      programs = Array.isArray(data) ? data : [];
      programs.sort((a, b) => {
        const ga = categoryGroup(a.slug);
        const gb = categoryGroup(b.slug);
        if (ga !== gb) {
          const order = { standalone: 0, executive: 1, dual: 2 };
          return (order[ga] ?? 9) - (order[gb] ?? 9);
        }
        return a.name.localeCompare(b.name);
      });
      renderCards();
    })
    .catch((err) => {
      console.error("Failed to load programs:", err);
      grid.innerHTML = "";
      const msg = document.createElement("p");
      msg.className = "grid-empty";
      msg.textContent = "Could not load programs. Refresh to try again.";
      grid.appendChild(msg);
    });
})();
