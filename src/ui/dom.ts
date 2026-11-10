/** Tiny DOM helpers for the menu screens. */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === false) continue;
    else if (v === true) el.setAttribute(k, '');
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

export function svg(markup: string, viewBox = '0 0 100 100'): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
