import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";

// Produce a 720×1280 9:16 portrait frame with the IE logo composited in the
// top-right corner. This frame is then passed to Veo as the starting image —
// Veo's image-to-video tends to preserve elements from frame 1 throughout the
// clip, so the logo stays on screen for all 8 seconds.

const CANVAS_W = 720;
const CANVAS_H = 1280;
const LOGO_TARGET_W = 200; // px wide on the 720 canvas — ~28% width, readable
const LOGO_MARGIN = 28;

export async function compositePortraitWithLogo(portraitBytes, logoFilePath) {
  // Step 1: figure out the source aspect ratio so we crop intelligently.
  const srcMeta = await sharp(portraitBytes, { failOn: "none" }).metadata();
  const srcW = srcMeta.width ?? CANVAS_W;
  const srcH = srcMeta.height ?? CANVAS_H;
  const srcRatio = srcW / srcH;
  const targetRatio = CANVAS_W / CANVAS_H; // 0.5625

  // For source images WIDER than 9:16 (most phone selfies / square avatars),
  // a cover crop would either zoom way in on a tiny center strip or chop off
  // the head. Instead, pad horizontally with a navy background so the face
  // stays fully visible at a reasonable size.
  //
  // For sources already taller/equal to 9:16, cover-crop with a top bias so
  // the head stays in frame.
  let portrait;
  if (srcRatio > targetRatio * 1.05) {
    // Wider than target: contain + pad.
    portrait = sharp(portraitBytes, { failOn: "none" })
      .resize({
        width: CANVAS_W,
        height: CANVAS_H,
        fit: "contain",
        background: { r: 0, g: 31, b: 92, alpha: 1 }, // IE Navy #001F5C from style guide
      })
      .removeAlpha();
  } else {
    portrait = sharp(portraitBytes, { failOn: "none" })
      .resize(CANVAS_W, CANVAS_H, { fit: "cover", position: "top" })
      .removeAlpha();
  }

  const logoPng = await rasterizeLogo(logoFilePath, LOGO_TARGET_W * 2);
  const logoSized = await sharp(logoPng)
    .resize({ width: LOGO_TARGET_W })
    .toBuffer();
  const meta = await sharp(logoSized).metadata();
  const logoH = meta.height ?? Math.round(LOGO_TARGET_W * 0.4);

  const composite = await portrait
    .composite([
      {
        input: logoSized,
        top: LOGO_MARGIN,
        left: CANVAS_W - LOGO_TARGET_W - LOGO_MARGIN,
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { bytes: composite, mime: "image/jpeg", width: CANVAS_W, height: CANVAS_H, logo: { width: LOGO_TARGET_W, height: logoH } };
}

async function rasterizeLogo(filePath, targetWidth = 400) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") {
    const resvg = new Resvg(buf, { fitTo: { mode: "width", value: targetWidth } });
    return resvg.render().asPng();
  }
  return buf;
}

// Find a usable logo file in styles/logos/. Prefers raster, falls back to SVG.
export async function findLogoPath(logoDir = "styles/logos") {
  const abs = path.join(process.cwd(), logoDir);
  const entries = await fs.readdir(abs).catch(() => []);
  const raster = entries.find((n) => !n.startsWith(".") && /\.(png|jpe?g|webp)$/i.test(n));
  const vector = entries.find((n) => !n.startsWith(".") && /\.svg$/i.test(n));
  const pick = raster ?? vector;
  return pick ? path.join(abs, pick) : null;
}
