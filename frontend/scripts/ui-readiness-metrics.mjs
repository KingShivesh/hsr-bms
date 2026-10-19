export function measureUi() {
  const scope = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(node => node.getClientRects().length).at(-1) || document;
  const visible = node => {
    if (!node.getClientRects().length || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = node; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; }
    return true;
  };
  const label = node => (node.getAttribute("aria-label") || node.textContent || node.placeholder || node.name || node.tagName).trim().slice(0, 90);
  const buttons = [...scope.querySelectorAll('button,a[role="button"]')].filter(visible);
  const shortTargets = innerWidth > 768 ? [] : buttons.filter(node => node.getBoundingClientRect().height < 43.9).map(node => ({ label: label(node), height: node.getBoundingClientRect().height, className: node.className }));
  const clipped = [...scope.querySelectorAll("h1,h2,h3,h4,p,td,th,span,strong,button")].filter(visible).filter(node => node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0 && getComputedStyle(node).overflowX === "hidden" && !node.title && !node.closest('[title]')).map(node => ({ text: label(node), width: node.clientWidth, contentWidth: node.scrollWidth, className: node.className }));
  return {
    applicationCrashed: document.body.innerText.includes("This page could not open."),
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    shortTargets, clipped,
    brokenImages: [...document.images].filter(node => visible(node) && (!node.complete || node.naturalWidth === 0)).map(node => node.alt),
    invalidCopy: [...new Set((document.body.innerText.match(/\bNaN\b|\bundefined\b|\bnull\b|\bTODO\b|Lorem ipsum|\[object Object\]|Invalid Date/g) || []))],
    unlabeledButtons: buttons.filter(node => !node.innerText.trim() && !node.getAttribute("aria-label") && !node.title).map(node => node.className),
    unlabeledInputs: [...scope.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible).filter(node => !node.labels?.length && !node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby") && !node.title).map(node => ({tag:node.tagName,placeholder:node.placeholder || "",name:node.name || "",type:node.type})),
    collectionSizes: Object.fromEntries([".op2-customer-card", ".sales-table tbody tr"].map(selector => [selector,document.querySelectorAll(selector).length])),
    contentOverflow: [...scope.querySelectorAll(".ui-overlay-body,.op2-metric-grid > div,.op2-customer-stats > div,.checkout-summary-grid > div,.ops-kpi,.lf-table-money,.report-empty-panel")].filter(visible).filter(node=>node.scrollWidth>node.clientWidth+2).map(node=>({className:node.className,width:node.clientWidth,contentWidth:node.scrollWidth})),
    palette: { accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(), font: getComputedStyle(document.body).fontFamily },
  };
}
