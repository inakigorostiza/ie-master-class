// Lightweight click-to-zoom lightbox shared across landing + admin.
// Looks for <a> links matching SELECTORS and opens the linked image/video
// in a centered modal. Builds a collection of peer items from the same
// selector so prev/next arrows + arrow keys cycle through them.
(() => {
  const SELECTORS = [
    ".gallery-item",
    ".reels-item",
    ".studio-banner a",
    ".studio-gallery-item a",
  ];

  let dialog = null;
  let mediaWrap = null;
  let prevBtn = null;
  let nextBtn = null;
  let items = [];
  let index = 0;

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "ie-lightbox";
    dialog.setAttribute("aria-label", "Creative preview");
    dialog.innerHTML = `
      <button type="button" class="ie-lightbox-close" aria-label="Close preview">×</button>
      <button type="button" class="ie-lightbox-nav ie-lightbox-prev" aria-label="Previous">‹</button>
      <div class="ie-lightbox-media"></div>
      <button type="button" class="ie-lightbox-nav ie-lightbox-next" aria-label="Next">›</button>
    `;
    document.body.appendChild(dialog);
    mediaWrap = dialog.querySelector(".ie-lightbox-media");
    prevBtn = dialog.querySelector(".ie-lightbox-prev");
    nextBtn = dialog.querySelector(".ie-lightbox-next");
    dialog.querySelector(".ie-lightbox-close").addEventListener("click", close);
    prevBtn.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    nextBtn.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) close();
    });
    dialog.addEventListener("close", () => { mediaWrap.innerHTML = ""; items = []; });
    document.addEventListener("keydown", (e) => {
      if (!dialog.open) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    });
  }

  function renderCurrent() {
    mediaWrap.innerHTML = "";
    const it = items[index];
    if (!it) return;
    if (it.kind === "video") {
      const v = document.createElement("video");
      v.src = it.url;
      v.controls = true;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      mediaWrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = it.url;
      img.alt = "";
      mediaWrap.appendChild(img);
    }
    const multiple = items.length > 1;
    prevBtn.hidden = !multiple;
    nextBtn.hidden = !multiple;
  }

  function step(delta) {
    if (items.length <= 1) return;
    index = (index + delta + items.length) % items.length;
    renderCurrent();
  }

  function open(url, kind) {
    openCollection([{ url, kind }], 0);
  }

  function openCollection(list, startIndex) {
    if (!list?.length) return;
    ensureDialog();
    items = list;
    index = Math.max(0, Math.min(startIndex | 0, items.length - 1));
    renderCurrent();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function close() {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    mediaWrap.innerHTML = "";
    items = [];
  }

  function linkToItem(link) {
    const url = link.getAttribute("href");
    if (!url) return null;
    const inner = link.querySelector("video, img");
    const isVideo = inner?.tagName === "VIDEO" || /\.(mp4|webm|mov)(\?|$)/i.test(url);
    return { url, kind: isVideo ? "video" : "image", el: link };
  }

  function collectionFor(link, matchedSelector) {
    // All <a> elements in the document that match the same triggering selector,
    // so prev/next can cycle through every peer item (gallery, reels grid,
    // history modal, or the full admin table of latest banners).
    const peers = Array.from(document.querySelectorAll(`${matchedSelector}, ${matchedSelector} a`))
      .filter((el) => el.tagName === "A")
      // de-dupe (a selector like `.gallery-item` already matches the anchor, while
      // its descendant `a` variant would double-count if anyone nests one inside).
      .filter((el, i, arr) => arr.indexOf(el) === i);
    const peerList = peers.length ? peers : [link];
    const list = peerList.map(linkToItem).filter(Boolean);
    const startIndex = Math.max(0, list.findIndex((it) => it.el === link));
    return { list, startIndex };
  }

  function onDocClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a");
    if (!link) return;
    const matched = SELECTORS.find((sel) => link.matches(sel) || link.closest(sel));
    if (!matched) return;
    if (!link.getAttribute("href")) return;
    e.preventDefault();
    const { list, startIndex } = collectionFor(link, matched);
    openCollection(list, startIndex);
  }

  document.addEventListener("click", onDocClick, true);

  window.IELightbox = { open, openCollection, close };
})();
