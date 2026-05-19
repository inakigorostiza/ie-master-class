// Lightweight click-to-zoom lightbox shared across landing + admin.
// Looks for <a> links inside any element matching SELECTORS and opens the
// linked image/video in a centered modal. Modifier/middle clicks fall
// through to the browser's open-in-new-tab behavior.
(() => {
  const SELECTORS = [
    ".gallery-item",
    ".reels-item",
    ".studio-banner a",
    ".studio-gallery-item a",
  ];

  let dialog = null;
  let mediaWrap = null;

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "ie-lightbox";
    dialog.setAttribute("aria-label", "Creative preview");
    dialog.innerHTML = `
      <button type="button" class="ie-lightbox-close" aria-label="Close preview">×</button>
      <div class="ie-lightbox-media"></div>
    `;
    document.body.appendChild(dialog);
    mediaWrap = dialog.querySelector(".ie-lightbox-media");
    dialog.querySelector(".ie-lightbox-close").addEventListener("click", close);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) close();
    });
    dialog.addEventListener("close", () => { mediaWrap.innerHTML = ""; });
  }

  function open(url, kind) {
    ensureDialog();
    mediaWrap.innerHTML = "";
    if (kind === "video") {
      const v = document.createElement("video");
      v.src = url;
      v.controls = true;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      mediaWrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      mediaWrap.appendChild(img);
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function close() {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    mediaWrap.innerHTML = "";
  }

  function onDocClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a");
    if (!link) return;
    if (!SELECTORS.some((sel) => link.matches(sel) || link.closest(sel))) return;
    const url = link.getAttribute("href");
    if (!url) return;
    const inner = link.querySelector("video, img");
    const isVideo = inner?.tagName === "VIDEO" || /\.(mp4|webm|mov)(\?|$)/i.test(url);
    e.preventDefault();
    open(url, isVideo ? "video" : "image");
  }

  document.addEventListener("click", onDocClick, true);

  window.IELightbox = { open, close };
})();
