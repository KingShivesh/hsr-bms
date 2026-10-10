import { PNG } from "pngjs";
import { scanTextContrast } from "./contrast-dom.mjs";

export async function scanRenderedContrast(page, metadata) {
  const candidates = await page.evaluate(scanTextContrast, { ...metadata, collect: true });
  if (candidates.some(c => c.gradient)) {
    // Hide glyph paint only, preserving currentColor fills and layout. Sample the
    // actual rendered gradient/image underneath each text line, not a CSS guess.
    const hide = await page.addStyleTag({ content: "body * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } input::placeholder,textarea::placeholder { color: transparent !important; } svg text { fill: transparent !important; }" });
    let pixels;
    try { pixels = PNG.sync.read(await page.screenshot({ fullPage: true })); }
    finally { await hide.evaluate(el => el.remove()); }
    const luminance = c => {
      const v = n => { n /= 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * v(c.r) + 0.7152 * v(c.g) + 0.0722 * v(c.b);
    };
    for (const candidate of candidates.filter(c => c.gradient)) {
      const ratios = [];
      for (const box of candidate.boxes) for (const position of [0.2, 0.5, 0.8]) {
        const x = Math.min(pixels.width - 1, Math.max(0, Math.round(box.x + box.width * position)));
        const y = Math.min(pixels.height - 1, Math.max(0, Math.round(box.y + box.height / 2)));
        const offset = (y * pixels.width + x) * 4;
        const bg = { r: pixels.data[offset], g: pixels.data[offset + 1], b: pixels.data[offset + 2] };
        const a = candidate.foreground.a;
        const fg = Object.fromEntries(["r", "g", "b"].map(c => [c, candidate.foreground[c] * a + bg[c] * (1 - a)]));
        const ratio = (Math.max(luminance(fg), luminance(bg)) + 0.05) / (Math.min(luminance(fg), luminance(bg)) + 0.05);
        ratios.push({ ratio, bg });
      }
      ratios.sort((a, b) => a.ratio - b.ratio);
      if (ratios.length) { candidate.ratio = +ratios[0].ratio.toFixed(2); candidate.background = ratios[0].bg; candidate.backgroundMethod = "rendered pixels, three samples per text line"; }
    }
  }
  return candidates.filter(c => c.ratio + 0.005 < c.required).map(({ boxes: _boxes, foreground: _foreground, ...result }) => result);
}
