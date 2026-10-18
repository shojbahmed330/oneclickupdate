// Picker runtime that gets dropped into the generated app's `public/` folder
// and loaded from `index.html`. Listens for postMessages from the Lovable
// Builder parent and, when picker mode is enabled, captures hover + click on
// any element, computes a short CSS-path selector, and posts a "selected"
// message back. The runtime is intentionally tiny and dependency-free.

export const PICKER_RUNTIME_JS = `(() => {
  if (window.__lovablePickerLoaded) return;
  window.__lovablePickerLoaded = true;

  const STYLE_ID = "lovable-picker-style";
  const HL_ID = "lovable-picker-highlight";
  const TIP_ID = "lovable-picker-tip";

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = \`
      #\${HL_ID}{position:fixed;pointer-events:none;z-index:2147483646;
        border:2px solid #6366f1;background:rgba(99,102,241,.12);
        border-radius:4px;transition:all .08s ease;display:none}
      #\${TIP_ID}{position:fixed;pointer-events:none;z-index:2147483647;
        background:#0f172a;color:#e2e8f0;font:12px/1.4 ui-monospace,SFMono-Regular,monospace;
        padding:4px 8px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);
        max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none}
      html.lovable-picker-on, html.lovable-picker-on *{cursor:crosshair !important}
    \`;
    document.documentElement.appendChild(s);
  }

  function ensureNodes(){
    ensureStyle();
    let hl = document.getElementById(HL_ID);
    if (!hl){ hl = document.createElement("div"); hl.id = HL_ID; document.body.appendChild(hl); }
    let tip = document.getElementById(TIP_ID);
    if (!tip){ tip = document.createElement("div"); tip.id = TIP_ID; document.body.appendChild(tip); }
    return { hl, tip };
  }

  // Walk up looking for a source-location attribute injected by Vite plugins
  // (e.g. data-lov-id, data-source-file, data-component-path). Tailwind class
  // selectors break in minified production builds — but data-* attrs survive
  // because they're explicit. Returns { file, line, col } when found.
  function sourceLocFor(el){
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 12){
      // Common conventions across React tooling
      const lov = cur.getAttribute && cur.getAttribute("data-lov-id");
      if (lov) {
        // Format: "src/path/File.tsx:line:col" — keep as-is, AI parses it
        return { raw: lov };
      }
      const file = cur.getAttribute && (cur.getAttribute("data-source-file") || cur.getAttribute("data-component-file"));
      if (file) {
        const line = cur.getAttribute("data-source-line") || cur.getAttribute("data-component-line") || "";
        const col  = cur.getAttribute("data-source-column") || cur.getAttribute("data-component-column") || "";
        return { raw: line ? (col ? file + ":" + line + ":" + col : file + ":" + line) : file };
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function selectorFor(el){
    if (!(el instanceof Element)) return "";
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 6 && cur !== document.body){
      let part = cur.tagName.toLowerCase();
      if (cur.id){ part += "#" + cur.id; parts.unshift(part); break; }
      const cls = (cur.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0,2);
      if (cls.length) part += "." + cls.join(".");
      const parent = cur.parentElement;
      if (parent){
        const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(cur) + 1) + ")";
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function summarise(el){
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 80);
    const role = el.getAttribute("role") || "";
    const aria = el.getAttribute("aria-label") || "";
    return { tag, text, role, aria };
  }

  let on = false;
  function setEnabled(v){
    on = !!v;
    document.documentElement.classList.toggle("lovable-picker-on", on);
    const { hl, tip } = ensureNodes();
    if (!on){ hl.style.display = "none"; tip.style.display = "none"; }
  }

  function onMove(e){
    if (!on) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const r = el.getBoundingClientRect();
    const { hl, tip } = ensureNodes();
    hl.style.display = "block";
    hl.style.left = r.left + "px";
    hl.style.top = r.top + "px";
    hl.style.width = r.width + "px";
    hl.style.height = r.height + "px";
    tip.style.display = "block";
    tip.textContent = selectorFor(el);
    tip.style.left = Math.min(window.innerWidth - 12, Math.max(8, r.left)) + "px";
    tip.style.top = Math.max(8, r.top - 26) + "px";
  }

  function onClick(e){
    if (!on) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (!(el instanceof Element)) return;
    const sel = selectorFor(el);
    const sum = summarise(el);
    const loc = sourceLocFor(el);
    try {
      window.parent.postMessage({
        type: "lovable:picker:selected",
        selector: sel,
        tag: sum.tag,
        text: sum.text,
        role: sum.role,
        ariaLabel: sum.aria,
        sourceLoc: loc ? loc.raw : null,
        url: location.pathname + location.search,
      }, "*");
    } catch {}
    setEnabled(false);
  }

  // ---- Edit (inline text) mode -----------------------------------------
  let editOn = false;
  const editOriginals = new WeakMap();

  function setEditMode(v){
    editOn = !!v;
    document.documentElement.classList.toggle("lovable-edit-on", editOn);
    if (!editOn) {
      // Disable contenteditable on any element we touched
      document.querySelectorAll("[data-lovable-edited]").forEach((n) => {
        n.removeAttribute("contenteditable");
        n.removeAttribute("data-lovable-edited");
      });
    }
  }

  function onEditFocus(e){
    if (!editOn) return;
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.isContentEditable) return;
    // Only enable on text-bearing leaf-ish nodes.
    if (!el.innerText || el.children.length > 4) return;
    if (!editOriginals.has(el)) editOriginals.set(el, el.innerText);
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-lovable-edited", "1");
    el.focus();
  }

  function onEditBlur(e){
    if (!editOn) return;
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute("data-lovable-edited")) return;
    const before = editOriginals.get(el) || "";
    const after = el.innerText;
    if (before === after) {
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-lovable-edited");
      return;
    }
    const loc = sourceLocFor(el);
    try {
      window.parent.postMessage({
        type: "lovable:edit:changed",
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        before: String(before).slice(0, 400),
        after: String(after).slice(0, 400),
        sourceLoc: loc ? loc.raw : null,
        url: location.pathname + location.search,
      }, "*");
    } catch {}
    // Revert visually so the live preview doesn't drift from real source.
    el.innerText = before;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-lovable-edited");
  }

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onEditFocus, true);
  window.addEventListener("blur", onEditBlur, true);

  // Inject edit-mode style.
  const editStyle = document.createElement("style");
  editStyle.textContent = \`
    html.lovable-edit-on [contenteditable="true"]{outline:2px dashed #f59e0b;outline-offset:2px;background:rgba(245,158,11,.08)}
    html.lovable-edit-on *:hover{outline:1px dashed rgba(245,158,11,.4)}
  \`;
  document.documentElement.appendChild(editStyle);

  window.addEventListener("message", (e) => {
    const d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "lovable:picker:enable") setEnabled(true);
    if (d.type === "lovable:picker:disable") setEnabled(false);
    if (d.type === "lovable:edit:enable") setEditMode(true);
    if (d.type === "lovable:edit:disable") setEditMode(false);
  });

  // Announce readiness so the parent can flip its toggle state.
  // Re-announce a few times in case the parent listener attached late
  // (race between iframe-load and React mount of useElementPicker).
  function announce(){ try { window.parent.postMessage({ type: "lovable:picker:ready" }, "*"); } catch {} }
  announce();
  setTimeout(announce, 200);
  setTimeout(announce, 800);
  setTimeout(announce, 2000);
})();`;
