# IE Business School — Brand Identity

> Extracted automatically by Claude Haiku 4.5 from a full-page screencap of
> `ie.edu/business-school` and three official IE banner samples, on
> 2026-05-18. Source: [`styles/style-guide.json`](styles/style-guide.json).
> Re-run with `npm run extract:styles` after dropping new reference assets in
> [`styles/pages/`](styles/pages/) or [`styles/banners/`](styles/banners/).

---

## Color palette

### Primary

| Swatch | Name | Hex | Role |
|---|---|---|---|
| <span style="display:inline-block;width:14px;height:14px;background:#001F5C;border:1px solid #ccc"></span> | **Navy Blue** | `#001F5C` | Primary brand color for headlines, CTAs, and key UI elements |
| <span style="display:inline-block;width:14px;height:14px;background:#1E9FE8;border:1px solid #ccc"></span> | **Sky Blue** | `#1E9FE8` | Accent color for CTAs, highlights, and visual interest |
| <span style="display:inline-block;width:14px;height:14px;background:#FFFFFF;border:1px solid #ccc"></span> | **White** | `#FFFFFF` | Background and text contrast |
| <span style="display:inline-block;width:14px;height:14px;background:#F5F5F5;border:1px solid #ccc"></span> | **Light Gray** | `#F5F5F5` | Secondary background and section dividers |

### Accent

| Swatch | Name | Hex | Role |
|---|---|---|---|
| <span style="display:inline-block;width:14px;height:14px;background:#00D4FF;border:1px solid #ccc"></span> | **Cyan** | `#00D4FF` | Circular photo frames and modern accent details |
| <span style="display:inline-block;width:14px;height:14px;background:#2D2D2D;border:1px solid #ccc"></span> | **Dark Gray** | `#2D2D2D` | Secondary text and subtle UI elements |

---

## Typography

| Use | Description | Weight | Case | Tracking |
|---|---|---|---|---|
| **Headline** | All-caps sans-serif for maximum impact and authority | 700–800 (Bold–Extra Bold) | ALL CAPS | tight |
| **Body** | Clean sans-serif for readability and contemporary feel | 400–500 | — | — |
| **CTA** | Rounded button text, all-caps, bold sans-serif | 700 | ALL CAPS | — |

---

## Photographic style

> Professional corporate portraiture with warm, neutral lighting; subjects
> against blurred modern office backgrounds; lifestyle and campus imagery with
> cool color grading; high-contrast black-and-white candid shots mixed with
> vibrant color photography.

---

## Logo treatment

> IE logo appears top-right with "BUSINESS SCHOOL" tagline in a navy
> background panel; clear space maintained around the wordmark; consistent
> placement across templates.

---

## Layout patterns

1. Left-aligned headline with right-aligned portrait or hero image
2. Full-width hero section with dark overlay and centered text
3. Three-column grid for program cards or case studies
4. Alternating image-text blocks with generous white space
5. Rounded circular photo frames with cyan border accent
6. Geometric shapes (rectangles, lines) layered behind or alongside imagery
7. Centered stat blocks with navy background and white text

---

## Mood

`Professional` · `Contemporary` · `Ambitious` · `Trustworthy` · `Forward-thinking` · `Approachable`

---

## Things to avoid

- Overly playful or casual imagery for executive programs
- Heavy use of bright warm colors competing with navy and cyan
- Serif typography for headlines or CTAs
- Cramped layouts without breathing room
- Low-contrast text on background images
- Inconsistent photo color grading across sections
- Placing the logo anywhere other than the top-right corner

---

## How this guide is used

| Surface | Consumer |
|---|---|
| Generated banners (Nano Banana Pro) | [lib/prompts/banner.js](lib/prompts/banner.js) — could inject via `lib/style-guide.js` if desired |
| Generated reels (Veo 3.1) | [lib/prompts/reel.js](lib/prompts/reel.js) — `styleGuideAsPromptBlock()` is embedded verbatim into the Veo prompt |
| Future creative formats | Read `styles/style-guide.json` directly or via `loadStyleGuide()` in [lib/style-guide.js](lib/style-guide.js) |

---

## Source references

- `styles/pages/screencapture-ie-edu-business-school-2026-05-18-15_47_39.png`
- `styles/banners/Trans-Banners-Marketing-Arbeo-DIRECCION-825x353-Enero2025.jpg`
- `styles/banners/Trans-Banners-Marketing-Arbeo-EJECUTIVOS-825x353-Enero2025.jpg`
- `styles/banners/header-school-social-media.jpeg`
