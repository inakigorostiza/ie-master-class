// Renders the AI-vs-human cost comparison chart inside #stats.
// Values default to a static demo scenario (100 prospects) so the chart
// has something to show before stats.js has fetched live data. After that
// stats.js calls window.__ieCompare.update({ aiValues, humanValues }) on
// every window change to recompute the bars.
(() => {
  const canvas = document.getElementById("stats-compare-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const css = getComputedStyle(document.documentElement);
  const colorNavy = css.getPropertyValue("--ie-navy").trim() || "#001F5C";
  const colorSky = css.getPropertyValue("--ie-sky").trim() || "#1E9FE8";
  const colorInk2 = css.getPropertyValue("--ie-ink-2").trim() || "#4a4d57";
  const colorLine = css.getPropertyValue("--ie-line").trim() || "#e3e6ed";

  const labels = ["Creative generation", "Outreach (email + WA + SMS)", "Total funnel"];

  // Defaults — illustrative scenario for 100 prospects. Replaced on the
  // first stats.js load() call with live numbers.
  let chart = null;

  const fmtEur = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  function build(aiValues, humanValues) {
    if (chart) {
      chart.data.datasets[0].data = aiValues;
      chart.data.datasets[1].data = humanValues;
      chart.update();
      return;
    }
    // eslint-disable-next-line no-undef
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "AI agents",
            data: aiValues,
            backgroundColor: colorSky,
            borderRadius: 6,
            maxBarThickness: 56,
          },
          {
            label: "Human team",
            data: humanValues,
            backgroundColor: colorNavy,
            borderRadius: 6,
            maxBarThickness: 56,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "x",
        scales: {
          y: {
            beginAtZero: true,
            type: "logarithmic",
            grid: { color: colorLine },
            ticks: {
              color: colorInk2,
              callback: (v) => fmtEur.format(v),
            },
          },
          x: {
            grid: { display: false },
            ticks: { color: colorInk2 },
          },
        },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { color: colorInk2, boxWidth: 12, boxHeight: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtEur.format(ctx.parsed.y)}`,
            },
          },
        },
      },
    });
  }

  // Initial static render so the chart shows something before the live
  // /api/stats fetch resolves.
  build([20, 4, 24], [1500, 250, 1750]);

  window.__ieCompare = {
    update: (aiValues, humanValues) => build(aiValues, humanValues),
  };
})();
