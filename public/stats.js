(() => {
  const section = document.getElementById("stats");
  if (!section) return;

  const kpiEl = section.querySelector("#stats-kpi");
  const tableBody = section.querySelector("#stats-table tbody");
  const emptyEl = section.querySelector("#stats-empty");
  const tableEl = section.querySelector("#stats-table");
  const tabsRoot = section.querySelector(".stats-window-tabs");

  const css = getComputedStyle(document.documentElement);
  const colorNavy = css.getPropertyValue("--ie-navy").trim() || "#001F5C";
  const colorSky = css.getPropertyValue("--ie-sky").trim() || "#1E9FE8";
  const colorCyan = css.getPropertyValue("--ie-cyan").trim() || "#00D4FF";
  const colorRed = css.getPropertyValue("--ie-red").trim() || "#E8002C";
  const colorInk = css.getPropertyValue("--ie-ink").trim() || "#14152e";
  const colorMuted = css.getPropertyValue("--ie-ink-2").trim() || "#4a4d57";
  const colorLine = css.getPropertyValue("--ie-line").trim() || "#e3e6ed";

  const PROVIDER_COLOR = {
    anthropic: colorNavy,
    openai: colorSky,
    google: colorCyan,
    elevenlabs: colorRed,
    heygen: "#7B5BFF",
    unknown: colorMuted,
  };
  const PALETTE = [colorNavy, colorSky, colorCyan, colorRed, "#7B5BFF", "#FF9F1C", "#2EC4B6", "#9D4EDD", "#06A77D", "#F26430"];

  const fmtEur = (n) => {
    const v = Number(n) || 0;
    if (v >= 100) return `€${v.toFixed(0)}`;
    if (v >= 1) return `€${v.toFixed(2)}`;
    if (v >= 0.01) return `€${v.toFixed(3)}`;
    return `€${v.toFixed(4)}`;
  };
  const fmtInt = (n) => {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return v.toLocaleString();
  };

  const charts = {};
  let currentSort = { key: "cost_eur", dir: "desc" };
  let currentModelRows = [];

  function setWindowTab(win) {
    tabsRoot.querySelectorAll("button").forEach((b) => {
      const active = b.dataset.window === win;
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function renderKPI(totals, studentsTotal) {
    const cells = [
      { label: "Total spend",   value: fmtEur(totals.cost_eur), sub: `${fmtInt(totals.calls)} AI calls` },
      { label: "Input tokens",  value: fmtInt(totals.input_tokens),  sub: `${fmtInt(totals.cached_tokens)} cached` },
      { label: "Output tokens", value: fmtInt(totals.output_tokens), sub: "Generated" },
      { label: "Media",         value: `${fmtInt(totals.image_count)} img · ${fmtInt(totals.audio_seconds)}s`, sub: "Banners + voice/video" },
      { label: "Students",      value: fmtInt(studentsTotal),         sub: "Profiles in Postgres" },
    ];
    kpiEl.innerHTML = cells
      .map(
        (c) => `
          <div class="stats-kpi-card">
            <p class="stats-kpi-label">${c.label}</p>
            <p class="stats-kpi-value">${c.value}</p>
            <p class="stats-kpi-sub">${c.sub}</p>
          </div>`
      )
      .join("");
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      charts[id] = null;
    }
  }

  function commonScaleOpts(isEur = false) {
    return {
      grid: { color: colorLine },
      ticks: {
        color: colorMuted,
        callback: isEur ? (v) => fmtEur(v) : (v) => fmtInt(v),
      },
    };
  }

  function renderDonut(byProvider) {
    const ctx = document.getElementById("stats-donut");
    if (!ctx) return;
    destroyChart("donut");
    const rows = byProvider.filter((r) => Number(r.cost_eur) > 0);
    if (!rows.length) return;
    charts.donut = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((r) => r.provider),
        datasets: [
          {
            data: rows.map((r) => Number(r.cost_eur)),
            backgroundColor: rows.map((r) => PROVIDER_COLOR[r.provider] || colorMuted),
            borderColor: "#fff",
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { color: colorInk, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                return `${ctx.label}: ${fmtEur(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  function renderBarModel(byModel) {
    const ctx = document.getElementById("stats-bar-model");
    if (!ctx) return;
    destroyChart("barModel");
    const rows = byModel.filter((r) => r.model).slice(0, 8);
    if (!rows.length) return;
    charts.barModel = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.model),
        datasets: [
          {
            label: "Cost (€)",
            data: rows.map((r) => Number(r.cost_eur)),
            backgroundColor: rows.map((r) => PROVIDER_COLOR[r.provider] || colorMuted),
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtEur(c.parsed.x) } },
        },
        scales: {
          x: commonScaleOpts(true),
          y: { grid: { display: false }, ticks: { color: colorInk } },
        },
      },
    });
  }

  function renderLine(daily) {
    const ctx = document.getElementById("stats-line");
    if (!ctx) return;
    destroyChart("line");
    if (!daily.length) return;
    charts.line = new Chart(ctx, {
      type: "line",
      data: {
        labels: daily.map((r) => fmtDay(r.day)),
        datasets: [
          {
            label: "Cost (€)",
            data: daily.map((r) => Number(r.cost_eur)),
            borderColor: colorSky,
            backgroundColor: hexToRgba(colorSky, 0.15),
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: colorNavy,
          },
          {
            label: "Calls",
            data: daily.map((r) => Number(r.calls)),
            borderColor: colorRed,
            backgroundColor: "transparent",
            tension: 0.3,
            pointRadius: 2,
            yAxisID: "y2",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { color: colorInk, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (c) => (c.dataset.label === "Calls" ? `${c.parsed.y} calls` : fmtEur(c.parsed.y)),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: colorMuted, maxRotation: 0, autoSkip: true } },
          y: commonScaleOpts(true),
          y2: {
            position: "right",
            grid: { display: false },
            ticks: { color: colorRed, callback: (v) => fmtInt(v) },
          },
        },
      },
    });
  }

  function renderStacked(byModel) {
    const ctx = document.getElementById("stats-stacked");
    if (!ctx) return;
    destroyChart("stacked");
    const rows = byModel.filter((r) => Number(r.input_tokens) || Number(r.output_tokens)).slice(0, 6);
    if (!rows.length) return;
    charts.stacked = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.model),
        datasets: [
          { label: "Input", data: rows.map((r) => Number(r.input_tokens)), backgroundColor: colorNavy, borderRadius: 4 },
          { label: "Output", data: rows.map((r) => Number(r.output_tokens)), backgroundColor: colorCyan, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: colorInk, boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: colorInk } },
          y: { stacked: true, ...commonScaleOpts(false) },
        },
      },
    });
  }

  function renderTable(rows) {
    currentModelRows = rows.slice();
    const sorted = sortRows(currentModelRows, currentSort.key, currentSort.dir);
    tableBody.innerHTML = sorted
      .map((r) => {
        const dot = PROVIDER_COLOR[r.provider] || colorMuted;
        return `
          <tr>
            <td><code>${escapeHtml(r.model ?? "—")}</code></td>
            <td><span class="stats-dot" style="background:${dot}"></span>${escapeHtml(r.provider ?? "—")}</td>
            <td>${escapeHtml(r.surface ?? "—")}</td>
            <td class="num">${fmtInt(r.calls)}</td>
            <td class="num">${fmtInt(r.input_tokens)}</td>
            <td class="num">${fmtInt(r.output_tokens)}</td>
            <td class="num"><strong>${fmtEur(r.cost_eur)}</strong></td>
          </tr>`;
      })
      .join("");
  }

  function sortRows(rows, key, dir) {
    const m = dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" || typeof bv === "number") return (Number(av || 0) - Number(bv || 0)) * m;
      return String(av ?? "").localeCompare(String(bv ?? "")) * m;
    });
  }

  function wireTableSort() {
    tableEl.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (currentSort.key === key) {
          currentSort.dir = currentSort.dir === "desc" ? "asc" : "desc";
        } else {
          currentSort = { key, dir: "desc" };
        }
        tableEl.querySelectorAll("th[data-sort]").forEach((h) => h.removeAttribute("aria-sort"));
        th.setAttribute("aria-sort", currentSort.dir === "desc" ? "descending" : "ascending");
        renderTable(currentModelRows);
      });
    });
  }

  async function load(win = "30d") {
    setWindowTab(win);
    try {
      const res = await fetch(`/api/stats?window=${encodeURIComponent(win)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const totals = json.totals ?? {};
      const hasData = Number(totals.calls) > 0;
      emptyEl.hidden = hasData;

      renderKPI(totals, json.students_total ?? 0);
      renderDonut(json.by_provider ?? []);
      renderBarModel(json.by_model ?? []);
      renderLine(json.daily ?? []);
      renderStacked(json.by_model ?? []);
      renderTable(json.by_model ?? []);
    } catch (err) {
      console.warn("[stats] load failed:", err);
      emptyEl.hidden = false;
      emptyEl.textContent = "Stats unavailable right now.";
    }
  }

  function init() {
    if (typeof Chart === "undefined") {
      // Chart.js loads with defer too; if it hasn't arrived yet, retry once.
      window.addEventListener("load", () => init(), { once: true });
      return;
    }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = colorInk;

    tabsRoot.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-window]");
      if (!btn) return;
      load(btn.dataset.window);
    });
    wireTableSort();
    load("30d");
  }

  function fmtDay(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return `rgba(30, 159, 232, ${alpha})`;
    const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
