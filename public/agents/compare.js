// Renders the AI-vs-human cost comparison chart inside #stats.
// Static, demo-only numbers — see <p.stats-compare-foot> in the markup for
// the assumptions behind them.
(() => {
  const canvas = document.getElementById("stats-compare-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const css = getComputedStyle(document.documentElement);
  const colorNavy = css.getPropertyValue("--ie-navy").trim() || "#001F5C";
  const colorSky = css.getPropertyValue("--ie-sky").trim() || "#1E9FE8";
  const colorInk2 = css.getPropertyValue("--ie-ink-2").trim() || "#4a4d57";
  const colorLine = css.getPropertyValue("--ie-line").trim() || "#e3e6ed";

  // For 100 prospects:
  //   designer 30 min/creative + copywriter 5 min/email + 2 min/SMS/WA at €30/h
  //   ≈ €1,500 creatives + €250 copy = €1,750 labor
  // AI side combines avg Gemini/Veo + Resend + Twilio per-message rates.
  const labels = ["Creative generation", "Outreach (email + WA + SMS)", "Total funnel"];
  const aiValues = [20, 4, 24];
  const humanValues = [1500, 250, 1750];

  const fmtEur = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  // eslint-disable-next-line no-undef
  new Chart(canvas, {
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
})();
