import type { Page } from '@playwright/test';

/**
 * Composite-aware WCAG 1.4.3 contrast measurement.
 *
 * This exists because axe is not a complete contrast oracle. Two classes of
 * text never reach the `violations` array a gate asserts on:
 *
 *  - text over a surface axe declines to resolve — a gradient, an `rgba()`
 *    over an unknown backdrop, or a `color-mix()`. Almost every surface that
 *    carries MEANING in this lab is one of those. The genre pill on every book
 *    card is teal ink on `rgba(0, 212, 184, 0.15)`; so are the correctness
 *    badge, the "Privacy Analysis" step badge, `.btn-secondary`, the
 *    differing-bit note, the privacy conclusion, the survivor columns in the
 *    cancellation grid, and the good why-card. The collusion block, its
 *    verdict, and `.btn-danger` are translucent reds; every `code` sits on
 *    `--color-code-bg` (`rgba(255,255,255,.04)` dark / `rgba(10,14,20,.06)`
 *    light); the hero-why aside is a `color-mix(in oklab, …)`; and the hero,
 *    visualizer and scaling sections each paint a `radial-gradient(ellipse at
 *    …)` wash over the page. axe files all of them under `incomplete`, so a
 *    violations-only gate measured the contrast of almost nothing this lab
 *    paints.
 *  - text faded by an ancestor's `opacity` — axe reads the declared `color`,
 *    which is not the colour that lands on screen. Here that is
 *    `.cl-hero-sub { opacity: .85 }`, every link at `a:hover { opacity: .8 }`,
 *    and the disabled query button at `opacity: .4` (exempt as inactive, and
 *    skipped as such). The cancellation grid's absent-marks used to be a
 *    fourth — `.cancel-off { opacity: .4 }` over `--color-muted`, roughly 2:1
 *    — until the pass that added this gate removed the fade; the class now
 *    relies on the muted ink alone, which clears 4.5:1 on the panel in both
 *    themes.
 *
 * So: walk every element that owns text, composite the real painted result
 * (translucent colours, gradient stops and opacity groups included), and
 * compute the ratio against the surface the text is genuinely sitting on
 * rather than against white. A gradient is judged at the text's own location.
 *
 * Opacity is modelled the way the compositor actually does it: an element with
 * `opacity < 1` renders its subtree into a group, then composites the group
 * over the backdrop. That means the *text* and the *background beside it* fade
 * onto the same backdrop independently — which is why both are carried through
 * the walk as a pair rather than fading the foreground alone.
 *
 * The ancestor walk is geometry-aware, because DOM ancestry is not the same
 * thing as "painted underneath". An absolutely positioned child can render
 * entirely outside its parent's box, and then the parent's background is
 * simply not behind it — the lab's own `.theme-toggle` is absolutely
 * positioned out of its header's flow in exactly that way (it is also
 * `display: none` under the shared bar, so it is skipped for that reason
 * first). An ancestor's own paint is applied only when its border box actually
 * intersects the text's box; a partial intersection still counts, so the
 * judgement stays worst-case. Opacity is unconditional either way — an opacity
 * group fades its whole subtree wherever that subtree happens to paint.
 *
 * Three shapes on this page that would otherwise make the helper report a
 * ratio nothing on screen has:
 *
 *  - TEXT SCROLLED OUT OF A CLIPPING ANCESTOR PAINTS NOTHING. The clipping
 *    boxes here are `#cancellation-grid` (`overflow-x: auto` around a
 *    `width: max-content` run of cancellation columns), the two `.cmp-code`
 *    request lines (`overflow-x: auto; white-space: nowrap`), and
 *    `.xor-chain-container`. At 380px most of the cancellation grid is
 *    genuinely outside the frame. Content scrolled past a clipper is not
 *    dimmed or partly drawn — it is absent, and asking what colour it sits on
 *    has no answer. Skip it, and rely on the content that IS in view, which is
 *    measured for real.
 *
 *  - TRANSPARENT TEXT PAINTS NOTHING. Anything drawn `color: transparent` lays
 *    no ink down; compositing a zero-alpha foreground just returns the
 *    backdrop and reports a fixed 1:1. Nothing here uses it today; the guard
 *    costs nothing.
 *
 *  - SVG PAINTS IN DOCUMENT ORDER, SO SIBLINGS CAN BE THE BACKGROUND. This
 *    lab's only SVG is decorative: the two GitHub glyphs and the shared bar's
 *    hamburger, which is three stroke-only `<line>`s — exactly the shape the
 *    FILLED-tags guard in `svgUnderlay` exists for, because `getComputedStyle`
 *    reports SVG's initial black `fill` for stroke-only geometry and
 *    compositing that invents an opaque black rectangle. Both figures the lab
 *    draws itself (the protocol diagram, the √N matrix) are CSS grids of
 *    `<div>`s/`<span>`s, so the sibling walk normally finds nothing to do. The
 *    branch is kept because the first labelled SVG figure anyone adds would
 *    otherwise be composited onto the `<svg>`'s transparent background rather
 *    than onto the shape drawn under it.
 *
 * ONE THING THIS WALK CANNOT SEE, stated so it is not mistaken for coverage:
 * text inside `aria-hidden` subtrees (see `ariaHidden` below for what this lab
 * hides there and the hand measurements that cover it). There is no
 * `<canvas>` anywhere on this page and no generated-content `::before/::after`
 * rule in `style.css`, so the usual two other blind spots are empty here —
 * `nontext.ts` still runs at every state so the first added pseudo-element
 * glyph is gated rather than invisible.
 */

export interface ContrastFailure {
  selector: string;
  text: string;
  foreground: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  required: number;
  ratio: number;
}

/**
 * `within` narrows the walk to one subtree.
 *
 * The default is the whole page, and that is what every `scan` in this lab
 * uses. Nothing here is short-lived enough to need the narrowed form: the
 * protocol's pacing is a `setTimeout` chain in `visualizer.ts`, and under the
 * reduced motion the gate asserts, `delay()` collapses every step to ≤10ms and
 * the drive only scans at settled completion signals — the transient
 * `flash-s1`/`flash-s2` card washes are already gone by the time a scan
 * starts. The parameter is kept because the narrowed form is what makes a
 * short-lived state measurable at all, the day one is added: a class that
 * lives 120ms is shorter than a full axe pass, and a sometimes-measured
 * assertion is worse than none.
 */
export async function auditContrast(page: Page, within = 'body *'): Promise<ContrastFailure[]> {
  return page.evaluate((rootSelector) => {
    interface RGBA {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
    const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

    /**
     * Resolve ANY CSS colour to straight-alpha sRGB via a 1×1 canvas.
     *
     * A hand-rolled `rgba()` regex is not enough here: the hero-why aside is a
     * `color-mix(in oklab, …)` and the shared top bar's ink and borders are
     * `color-mix(in srgb, …)`, which Chromium reports to `getComputedStyle`
     * unchanged rather than converted. A regex that only understands
     * `rgb()/rgba()` sees `null` for every one of them and the walk then falls
     * through to the wrong backdrop — which fabricates failures and, far
     * worse, can hide a real one. The 2D canvas is the browser's own colour
     * pipeline: assigning `fillStyle` converts any valid CSS colour to sRGB,
     * and a painted pixel carries the straight alpha back. Invalid input is
     * rejected by the two-sentinel check so it cannot masquerade as black.
     */
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const colorCache = new Map<string, RGBA | null>();
    const resolve = (c: string): RGBA | null => {
      if (!c) return null;
      const cached = colorCache.get(c);
      if (cached !== undefined) return cached;
      let rgba: RGBA | null = null;
      // A valid colour normalises to the same value from either sentinel; an
      // invalid string leaves each sentinel in place and the two disagree.
      ctx.fillStyle = '#000';
      ctx.fillStyle = c;
      const fromBlack = ctx.fillStyle;
      ctx.fillStyle = '#fff';
      ctx.fillStyle = c;
      const fromWhite = ctx.fillStyle;
      if (fromBlack === fromWhite) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        rgba = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
      colorCache.set(c, rgba);
      return rgba;
    };

    /** Split on a separator char that sits at paren-nesting depth 0. */
    const splitTopLevel = (str: string, sep: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of str) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === sep && depth === 0) {
          out.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) out.push(cur);
      return out;
    };

    /** Standard source-over compositing of a (possibly translucent) src on dst. */
    const over = (src: RGBA, dst: RGBA): RGBA => {
      const a = src.a + dst.a * (1 - src.a);
      if (a === 0) return TRANSPARENT;
      return {
        r: (src.r * src.a + dst.r * dst.a * (1 - src.a)) / a,
        g: (src.g * src.a + dst.g * dst.a * (1 - src.a)) / a,
        b: (src.b * src.a + dst.b * dst.a * (1 - src.a)) / a,
        a,
      };
    };

    const fade = (c: RGBA, o: number): RGBA => (o >= 1 ? c : { ...c, a: c.a * o });

    const luminance = (c: RGBA): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };

    const ratio = (a: RGBA, b: RGBA): number => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    interface Point {
      x: number;
      y: number;
    }
    interface Stop {
      color: RGBA;
      pos: number;
    }

    const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

    /**
     * Interpolate a gradient's stop list at fraction `t`, in premultiplied
     * straight-alpha, the way the compositor blends a fade-to-`transparent` —
     * which is the ONLY kind of gradient this page paints: all three section
     * washes run `rgba(0, 212, 184, 0.03–0.04)` down to `transparent`.
     */
    const colorAt = (stops: Stop[], t: number): RGBA => {
      if (!stops.length) return TRANSPARENT;
      if (t <= stops[0].pos) return stops[0].color;
      const last = stops[stops.length - 1];
      if (t >= last.pos) return last.color;
      let i = 0;
      while (i < stops.length - 1 && stops[i + 1].pos < t) i++;
      const a = stops[i];
      const b = stops[i + 1];
      const span = b.pos - a.pos;
      const f = span <= 0 ? 0 : (t - a.pos) / span;
      const al = a.color.a + (b.color.a - a.color.a) * f;
      const pr = a.color.r * a.color.a + (b.color.r * b.color.a - a.color.r * a.color.a) * f;
      const pg = a.color.g * a.color.a + (b.color.g * b.color.a - a.color.g * a.color.a) * f;
      const pb = a.color.b * a.color.a + (b.color.b * b.color.a - a.color.b * a.color.a) * f;
      return al === 0 ? TRANSPARENT : { r: pr / al, g: pg / al, b: pb / al, a: al };
    };

    /** Parse the colour-stop list of a gradient, normalising positions to 0..1. */
    const parseStops = (parts: string[]): Stop[] => {
      const raw: { color: RGBA; pos: number | null }[] = [];
      for (const part of parts) {
        const tokens = splitTopLevel(part.trim(), ' ').filter(Boolean);
        let color: RGBA | null = null;
        const positions: number[] = [];
        for (const tok of tokens) {
          const c = resolve(tok);
          if (c && !color) color = c;
          else if (tok.endsWith('%')) positions.push(parseFloat(tok) / 100);
        }
        if (!color) continue;
        // A stop may carry two positions (a hard band); emit one per position.
        if (positions.length === 0) raw.push({ color, pos: null });
        else for (const p of positions) raw.push({ color, pos: p });
      }
      if (!raw.length) return [];
      if (raw[0].pos === null) raw[0].pos = 0;
      if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
      for (let i = 1; i < raw.length - 1; i++) {
        if (raw[i].pos !== null) continue;
        let j = i;
        while (j < raw.length && raw[j].pos === null) j++;
        const lo = raw[i - 1].pos as number;
        const hi = (raw[j]?.pos as number) ?? 1;
        for (let k = i; k < j; k++) raw[k].pos = lo + ((hi - lo) * (k - i + 1)) / (j - i + 1);
      }
      // CSS clamps positions to be non-decreasing.
      let run = 0;
      return raw.map((s) => {
        run = Math.max(run, s.pos as number);
        return { color: s.color, pos: run };
      });
    };

    const axisValue = (tok: string, origin: number, extent: number): number => {
      if (tok === 'left' || tok === 'top') return origin;
      if (tok === 'right' || tok === 'bottom') return origin + extent;
      if (tok === 'center') return origin + extent / 2;
      if (tok.endsWith('%')) return origin + (parseFloat(tok) / 100) * extent;
      if (tok.endsWith('px')) return origin + parseFloat(tok);
      return origin + extent / 2;
    };

    const VERT = new Set(['top', 'bottom']);
    const HORZ = new Set(['left', 'right']);

    /**
     * Evaluate one background-image layer at a document point.
     *
     * A gradient judged at its worst *stop* is right only when that stop spans
     * the element, which is not true of this page's washes: `.section-hero`,
     * `.section-visualizer` and `.section-scaling` each run a
     * `radial-gradient(ellipse at 70% 40% / 20% 60% / 80% 30%)` across a
     * section several screens tall, so text near the wash centre sits on a
     * (slightly) different surface than text at its edge. Each gradient is
     * therefore *sampled* at the text's real location: linear by projecting
     * onto the gradient line, radial by distance from the centre over the
     * farthest-corner radius — an `ellipse` is approximated as that circle,
     * which for washes this faint (0.03–0.04 alpha) moves the result by less
     * than a rounding step. A non-gradient layer (`url()`, `none`) is
     * unmeasurable and paints nothing.
     */
    const sampleLayer = (layer: string, rect: DOMRect, p: Point): RGBA => {
      if (!/gradient/.test(layer)) return TRANSPARENT;
      const inner = layer.slice(layer.indexOf('(') + 1, layer.lastIndexOf(')'));
      const parts = splitTopLevel(inner, ',').map((s) => s.trim());
      const radial = /radial-gradient/.test(layer);
      // The first part is configuration (angle / shape / position) exactly when
      // it holds no resolvable colour.
      const firstColour = parts[0]
        ? splitTopLevel(parts[0], ' ').some((t) => resolve(t.trim()))
        : false;
      const config = firstColour ? '' : parts[0] ?? '';
      const stops = parseStops(firstColour ? parts : parts.slice(1));
      if (!stops.length) return TRANSPARENT;

      if (radial) {
        // Centre: `... at X Y`. Default centre of the box.
        let cx = rect.left + rect.width / 2;
        let cy = rect.top + rect.height / 2;
        const at = config.split(/\s+at\s+/)[1];
        if (at) {
          const toks = at.split(/\s+/).filter(Boolean);
          const kw = toks.filter((t) => VERT.has(t) || HORZ.has(t) || t === 'center');
          const vals = toks.filter((t) => !kw.includes(t));
          for (const t of toks) {
            if (HORZ.has(t)) cx = axisValue(t, rect.left, rect.width);
            else if (VERT.has(t)) cy = axisValue(t, rect.top, rect.height);
          }
          if (vals[0]) cx = axisValue(vals[0], rect.left, rect.width);
          if (vals[1]) cy = axisValue(vals[1], rect.top, rect.height);
        }
        // Default ending shape is farthest-corner.
        const corners = [
          [rect.left, rect.top],
          [rect.right, rect.top],
          [rect.left, rect.bottom],
          [rect.right, rect.bottom],
        ];
        const radius = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        const t = radius <= 0 ? 0 : Math.hypot(p.x - cx, p.y - cy) / radius;
        return colorAt(stops, clamp01(t));
      }

      // Linear. Default direction is `to bottom` (180deg).
      let angle = 180;
      if (/deg/.test(config)) angle = parseFloat(config);
      else if (/to\s+top/.test(config)) angle = 0;
      else if (/to\s+right/.test(config)) angle = 90;
      else if (/to\s+left/.test(config)) angle = 270;
      const rad = (angle * Math.PI) / 180;
      const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
      const len = Math.abs(rect.width * Math.sin(rad)) + Math.abs(rect.height * Math.cos(rad));
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const d = (p.x - cx) * dir.x + (p.y - cy) * dir.y;
      const t = len <= 0 ? 0.5 : 0.5 + d / len;
      return colorAt(stops, clamp01(t));
    };

    /**
     * The colour this element's own box paints at the text point: its
     * background-color with every background-image layer sampled and composited
     * in paint order (first-listed layer on top).
     */
    const paintAt = (cs: CSSStyleDeclaration, rect: DOMRect, p: Point): RGBA => {
      let result = resolve(cs.backgroundColor) ?? TRANSPARENT;
      const bi = cs.backgroundImage;
      if (!bi || bi === 'none') return result;
      const layers = splitTopLevel(bi, ',').map((s) => s.trim());
      // Composite bottom (last-listed) up to top (first-listed).
      for (let i = layers.length - 1; i >= 0; i--) {
        result = over(sampleLayer(layers[i], rect, p), result);
      }
      return result;
    };

    /** Do two border boxes share any painted area at all? */
    const intersects = (a: DOMRect, b: DOMRect): boolean =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 0 &&
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 0;

    /** Does `a` sit entirely inside `b`? */
    const contains = (outer: DOMRect, inner: DOMRect): boolean =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;

    /**
     * Style and geometry are memoised per element for one pass.
     *
     * A driven pass here walks the whole page with every phase panel rendered:
     * 16 bit squares, an XOR chain per server, a cancellation column per set
     * mask bit, 8 book cards, and every prose block — hundreds of siblings all
     * re-walking the same ancestors up to `<body>`. Without the caches the
     * pass re-reads the same computed styles and rects thousands of times.
     * Nothing mutates the DOM during the pass, so the cached values cannot go
     * stale.
     */
    const styleCache = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (el: Element): CSSStyleDeclaration => {
      let cs = styleCache.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styleCache.set(el, cs);
      }
      return cs;
    };
    const rectCache = new Map<Element, DOMRect>();
    const rectOf = (el: Element): DOMRect => {
      let r = rectCache.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        rectCache.set(el, r);
      }
      return r;
    };

    /**
     * Every container that clips its overflow, with the box it clips to.
     *
     * An `overflow: auto` container paints only what falls inside that box.
     * Content scrolled beyond it is not dimmed or partly drawn — it is absent
     * from the frame, and asking what colour it sits on has no answer. Here
     * that is `#cancellation-grid` (whose `width: max-content` column run
     * genuinely scrolls at 380px), the two `.cmp-code` nowrap request lines,
     * and `.xor-chain-container`.
     */
    const clippers = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const cs = styleOf(el);
      return /auto|scroll|hidden|clip/.test(cs.overflowX + ' ' + cs.overflowY);
    });

    const clippedAway = (el: Element, box: DOMRect): boolean =>
      clippers.some((c) => c !== el && c.contains(el) && !intersects(box, rectOf(c)));

    /**
     * SVG has no `background-color`: shapes paint in document order, so the
     * surface under a `<text>` is whichever earlier sibling shape lies beneath
     * it. Composite those, innermost-last, before the ancestor walk starts.
     */
    const svgUnderlay = (el: Element, box: DOMRect): RGBA => {
      let bg = TRANSPARENT;
      let sib = el.previousElementSibling;
      const stack: Element[] = [];
      while (sib) {
        stack.push(sib);
        sib = sib.previousElementSibling;
      }
      // Earliest sibling first — that is the order the compositor paints in.
      // Only shapes that actually PAINT A FILL can be a backdrop. SVG's
      // initial `fill` is black, and `getComputedStyle` reports that for
      // stroke-only geometry too — so a <line> reads as an opaque black
      // rectangle covering whatever it crosses. This page's only SVG is
      // decorative and glyph-free (the two GitHub `<path>` icons and the
      // shared bar's hamburger, which is three stroke-only `<line>`s — exactly
      // the shape this guard exists for), so neither branch runs today; the
      // rule is the one that would apply the moment a labelled SVG figure is
      // added.
      const FILLED = ['rect', 'circle', 'ellipse', 'polygon', 'path'];
      for (const s of stack.reverse()) {
        if (!FILLED.includes(s.tagName.toLowerCase())) continue;
        if (!contains(rectOf(s), box)) continue;
        const scs = styleOf(s);
        const fill = resolve(scs.fill);
        if (!fill) continue;
        const op = parseFloat(scs.fillOpacity || '1') * parseFloat(scs.opacity || '1');
        bg = over(fade(fill, Number.isFinite(op) ? op : 1), bg);
      }
      return bg;
    };

    /**
     * Does this element's own `clip` / `clip-path` reduce it to zero area?
     *
     * `clip: rect(...)` at zero area and `clip-path: inset(50%)` are the two
     * spellings of the visually-hidden idiom; either means the compositor
     * draws nothing, so there is no painted ink to measure. `style.css`
     * declares neither — its one visually-hidden element, the skip link, parks
     * off-screen instead — so the guard is inert here today. It is kept, and
     * kept deliberately narrow (only a ZERO-AREA clip qualifies, so a
     * partially clipped element is still measured, worst case), because the
     * recipe is the standard one and the first `.sr-only` span added would
     * otherwise be measured as a ~1:1 failure for ink never laid down.
     */
    const clippedToNothing = (cs: CSSStyleDeclaration): boolean => {
      const clip = cs.clip;
      if (clip && clip !== 'auto') {
        const nums = clip.match(/-?[\d.]+/g)?.map(Number);
        if (nums && nums.length === 4) {
          const [top, right, bottom, left] = nums as [number, number, number, number];
          if (bottom - top <= 0 || right - left <= 0) return true;
        }
      }
      // `inset(50%)` (and anything >= 50% on both axes) collapses to nothing.
      const path = cs.clipPath;
      if (path && path.startsWith('inset(')) {
        const pct = path.match(/([\d.]+)%/g)?.map((v) => parseFloat(v)) ?? [];
        if (pct.length && pct.every((v) => v >= 50)) return true;
      }
      return false;
    };

    const isVisible = (el: Element): boolean => {
      const cs = styleOf(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      // `checkVisibility()` also catches `content-visibility: hidden`, which
      // keeps last-laid-out geometry so the display/rect tests above pass for
      // text that paints nothing. Nothing here uses it today (this page's
      // hidden panels are `display: none` via `.phase-hidden`, `[hidden]` and
      // inline style), but the phase panels are exactly where a refactor to
      // `content-visibility` would land.
      if ((el as HTMLElement).checkVisibility?.() === false) return false;
      const r = rectOf(el);
      if (r.width <= 0 || r.height <= 0) return false;
      // Text parked off the left/top edge of the page paints no pixels. This
      // is the WCAG-sanctioned "visually hidden until focused" idiom, and this
      // page has one: the shared header's `.cl-skip-link` parks at
      // `top: -3rem`. Measuring the parked copy invents a failure for text
      // that is not on screen; the focused rendering is a real state and the
      // gate scans it explicitly instead.
      // Document space, NOT viewport space: `getBoundingClientRect()` is
      // viewport-relative, so after Playwright scrolls a control into view
      // every element above the viewport has `bottom <= 0` and a naive guard
      // silently drops most of a long page from the walk. Adding the scroll
      // offset keeps the original intent without hiding the page.
      if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false;
      // Scrolled out of an `overflow: auto` container — clipped, not painted.
      if (clippedAway(el, r)) return false;
      if (clippedToNothing(cs)) return false;
      return true;
    };

    const ownText = (el: Element): string => {
      let t = '';
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? '';
      }
      return t.trim();
    };

    const describe = (el: Element): string => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      const cls = el.getAttribute('class');
      if (cls) s += `.${cls.trim().split(/\s+/).join('.')}`;
      return s;
    };

    /**
     * WCAG 1.4.3 exempts text that is part of an *inactive* user-interface
     * component, and axe skips disabled controls for the same reason. Honour
     * that here so the query button's shipped state — `disabled` at
     * `opacity: .4` until a book is selected — is not reported as a failure
     * the spec does not actually require fixing.
     */
    const inactive = (el: Element): boolean => {
      let n: Element | null = el;
      while (n) {
        if ((n as HTMLInputElement).disabled === true) return true;
        if (n.getAttribute('aria-disabled') === 'true') return true;
        n = n.parentElement;
      }
      return false;
    };

    /**
     * `aria-hidden` text is removed from the accessibility tree, so axe's own
     * `color-contrast` rule skips it — and this arithmetic oracle exists to
     * catch what axe *misses* among exposed text (gradients, rgba, opacity),
     * not to be stricter than axe on decorative content. Honour the same
     * boundary.
     *
     * The boundary cuts both ways and is a known gap: text that is
     * `aria-hidden` but still painted is skipped by BOTH oracles, so what this
     * lab hides was enumerated and measured by hand rather than assumed:
     *
     *  - `.matrix-diagram`, the whole √N figure — the only aria-hidden subtree
     *    here with load-bearing text (the 0/1 mask bits, the two √N labels,
     *    the ↦ row marks). It is hidden deliberately: the adjacent
     *    `.scaling-text` prose states every fact the figure draws. Measured by
     *    hand: `.mb-on` is `--color-bg` ink on the `--color-s1` fill (≈10:1
     *    dark, ≈5.2:1 light) and the labels are `--color-muted` on the section
     *    (≈5.9:1 dark, ≈6.4:1 light). `.mb-off` measured 4.27:1 in the LIGHT
     *    theme (`#515c6b` on `#c8cdd4`) — under 4.5:1, invisible to every
     *    oracle here — and was fixed to `#414b58` (≈5.5:1) in the same pass
     *    that added this gate.
     *  - single decorative glyphs whose meaning the adjacent text carries: the
     *    `→` status icon, the two `⚠` marks, the `✓` in the PIR panel label,
     *    the `⊕`/`=` operators in the reconstruction and collusion rows, and
     *    the two server dots (no text at all).
     *
     * Nothing here hides a VALUE: every mask hex, response byte, index list,
     * count and verdict is exposed text and IS measured. (The cancellation
     * grid used to be a third aria-hidden subtree; the pass that added this
     * gate exposed it as a labelled region, so its columns are now measured
     * like everything else.)
     */
    const ariaHidden = (el: Element): boolean => {
      let n: Element | null = el;
      while (n) {
        if (n.getAttribute('aria-hidden') === 'true') return true;
        n = n.parentElement;
      }
      return false;
    };

    /**
     * SVG renders character data only inside `<text>` / `<tspan>`. Text
     * sitting directly in a `<g>`, `<svg>` or shape element is in the DOM but
     * paints nothing, so it has no colour and no contrast requirement. This
     * lab's SVG carries no character data at all; the guard costs nothing and
     * protects the first SVG figure anyone adds.
     */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const nonRenderingSvgText = (el: Element): boolean =>
      el.namespaceURI === SVG_NS && !['text', 'tspan'].includes(el.tagName.toLowerCase());

    /**
     * The CANVAS background — what is painted behind everything.
     *
     * CSS propagates the root element's background to the canvas and paints it
     * over the whole canvas regardless of the root's own box (CSS Backgrounds
     * 3, "The Canvas Background"); if the root's own background is transparent
     * the value is taken from `<body>` instead. Without this rule, an element
     * that intersects no painted ancestor falls through to WHITE, which on the
     * dark theme fabricates failures for a page that does not exist.
     *
     * On this page `<html>` paints nothing and `<body>` carries an opaque
     * `background-color: var(--color-bg)`, so the propagated canvas colour IS
     * the body colour — and because `<body>` here grows with its content, the
     * ancestor walk usually finds it anyway. The propagation rule still
     * matters for anything positioned outside the body's box (the parked skip
     * link once focused, at 380px overscroll) and it is what keeps this helper
     * correct if the background ever moves into a shorthand with image layers,
     * where `backgroundColor` alone reads `rgba(0,0,0,0)`.
     */
    const canvasBackground = ((): RGBA => {
      const rootCs = styleOf(document.documentElement);
      const rootRect = rectOf(document.documentElement);
      const rootPaint = paintAt(rootCs, rootRect, {
        x: rootRect.left + rootRect.width / 2,
        y: rootRect.top + rootRect.height / 2,
      });
      if (rootPaint.a > 0) return rootPaint;
      const body = document.body;
      if (!body) return TRANSPARENT;
      const bodyRect = rectOf(body);
      return paintAt(styleOf(body), bodyRect, {
        x: bodyRect.left + bodyRect.width / 2,
        y: bodyRect.top + bodyRect.height / 2,
      });
    })();

    const failures: unknown[] = [];
    for (const el of Array.from(document.querySelectorAll(rootSelector))) {
      const text = ownText(el);
      if (!text) continue;
      if (!isVisible(el)) continue;
      if (inactive(el)) continue;
      if (ariaHidden(el)) continue;
      if (nonRenderingSvgText(el)) continue;

      const cs = styleOf(el);
      // SVG text takes its ink from `fill`, not `color`.
      const svgText = el.namespaceURI === 'http://www.w3.org/2000/svg';
      const fgRaw = resolve(svgText ? cs.fill : cs.color);
      if (!fgRaw) continue;
      // `color: transparent` lays no ink down at all; compositing a zero-alpha
      // foreground just returns the backdrop and reports a fixed 1:1.
      if (fgRaw.a === 0) continue;

      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;

      // Carry (text, adjacent background) as a pair up the ancestor chain,
      // sampling each ancestor's own background at the text point beneath both
      // and applying that ancestor's opacity to both, exactly as the
      // compositor would. The point is the text box centre.
      const textBox = rectOf(el);
      const point: Point = {
        x: (textBox.left + textBox.right) / 2,
        y: (textBox.top + textBox.bottom) / 2,
      };
      // For SVG text the first thing beneath the glyphs is a sibling shape,
      // not an ancestor's background.
      let fg = fgRaw;
      let bg = svgText ? svgUnderlay(el, textBox) : TRANSPARENT;
      let node: Element | null = el;
      while (node) {
        const ncs = styleOf(node);
        const opacity = parseFloat(ncs.opacity);
        // An ancestor that does not overlap the text paints nothing behind it.
        const paint =
          node === el || intersects(textBox, rectOf(node))
            ? paintAt(ncs, rectOf(node), point)
            : TRANSPARENT;
        fg = fade(over(fg, paint), opacity);
        bg = fade(over(bg, paint), opacity);
        // Stop once the accumulated backdrop is fully opaque: nothing further
        // out can change the painted result.
        if (bg.a >= 1) break;
        node = node.parentElement;
      }

      const fgFinal = over(over(fg, canvasBackground), WHITE);
      const bgFinal = over(over(bg, canvasBackground), WHITE);
      const worst = { r: ratio(fgFinal, bgFinal), fg: fgFinal, bg: bgFinal };

      // Round to 2dp before comparing so a value that is exactly on the floor
      // (e.g. 4.50) is not failed by float noise, and one just under it is not
      // rounded up into a pass.
      const rounded = Math.round(worst.r * 100) / 100;
      if (rounded >= required) continue;

      const show = (c: RGBA): string =>
        `rgb(${[c.r, c.g, c.b].map((v) => Math.round(v)).join(', ')})`;

      failures.push({
        selector: describe(el),
        text: text.slice(0, 60),
        foreground: show(worst.fg),
        background: show(worst.bg),
        fontSize: size,
        fontWeight: weight,
        required,
        ratio: rounded,
      });
    }
    return failures as never;
  }, within);
}

/** Render failures as short strings so an assertion diff is readable. */
export function formatContrastFailures(failures: ContrastFailure[]): string[] {
  return failures.map(
    (f) =>
      `${f.ratio}:1 (needs ${f.required}:1) ${f.selector} — fg ${f.foreground} on ${f.background} — "${f.text}"`
  );
}
