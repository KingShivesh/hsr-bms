// Run inside the page: flatten translucent layers instead of skipping faint text.
export function scanTextContrast({ route, theme, state, collect = false }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const parse = value => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const composite = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const luminance = color => {
    const c = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(color.r) + 0.7152 * c(color.g) + 0.0722 * c(color.b);
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const selector = el => el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + [...el.classList].slice(0, 5).map(c => `.${CSS.escape(c)}`).join("");
  const background = el => {
    const nodes = [];
    for (let n = el; n; n = n.parentElement) nodes.unshift(n);
    let color = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!color.a) color = parse(document.body.classList.contains("dark") ? "#0b0b0f" : "#fafafa");
    for (const n of nodes) color = composite(parse(getComputedStyle(n).backgroundColor), color);
    return color;
  };
  const violations = [];
  const modal = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(e => e.getBoundingClientRect().width && getComputedStyle(e).visibility === "visible").at(-1);
  for (const el of document.body.querySelectorAll("*")) {
    if (modal && !modal.contains(el)) continue;
    if (["OPTION", "SCRIPT", "STYLE"].includes(el.tagName)) continue;
    const s = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || s.visibility !== "visible" || s.display === "none") continue;
    let opacity = 1, hidden = false;
    for (let n = el; n; n = n.parentElement) {
      const ns = getComputedStyle(n);
      opacity *= Number(ns.opacity);
      if (ns.display === "none" || ns.visibility !== "visible" || n.inert || n.getAttribute("aria-hidden") === "true") hidden = true;
    }
    if (hidden || opacity < 0.01 || el.matches(":disabled") || el.closest("button:disabled,[aria-disabled='true']")) continue;
    let text = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).join(" ").trim();
    let style = s, kind = "text";
    if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select")) {
      text = el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent : el.value;
      kind = "input-value";
      if (!text && el.placeholder) { text = el.placeholder; style = getComputedStyle(el, "::placeholder"); kind = "placeholder"; }
    }
    if (!text) continue;
    const paint = el.namespaceURI === "http://www.w3.org/2000/svg" && el.matches("text,tspan") ? s.fill : style.color;
    const bg = background(el), fg = parse(paint);
    fg.a *= opacity * (kind === "placeholder" ? Number(style.opacity) : 1);
    const actual = ratio(composite(fg, bg), bg);
    const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight) || 400;
    const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    let gradient = false;
    for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).backgroundImage !== "none") gradient = true;
    let boxes = [rect];
    if (kind === "text") {
      boxes = [];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(node);
        boxes.push(...range.getClientRects());
      }
    }
    if (collect || actual + 0.005 < required) violations.push({ route, theme, state, selector: selector(el), kind, text: text.slice(0, 100), color: paint, foreground: fg, background: bg, fontSize: style.fontSize, fontWeight: style.fontWeight, ratio: +actual.toFixed(2), required, gradient, boxes: boxes.map(r => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height })) });
  }
  return violations;
}
