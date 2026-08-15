import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec's
 *     `neutralizeMotion()` pushed `transition:none!important;
 *     animation:none!important` through `addStyleTag`, and on this page that
 *     was not merely a bypass of the reduced-motion CSS — it BLANKED THE CORE
 *     EXHIBIT. `renderBitmask()` in `visualizer.ts` parks every bit square at
 *     inline `opacity: 0` and relies on the `bitAppear` animation's `forwards`
 *     fill to bring it to 1; `animation: none !important` beats the inline
 *     animation, so under the old gate the squares never reached opacity 1 and
 *     both query masks were scanned INVISIBLE in every run. `visualizer.ts`
 *     also branches on `matchMedia('(prefers-reduced-motion: reduce)')` in
 *     JavaScript three times (the stagger in `renderBitmask`, the
 *     character-by-character `animateReveal`, and the pacing `delay`), and a
 *     style tag cannot reach a `matchMedia` call — so the old gate never once
 *     scanned the rendering a reader with the preference set actually gets.
 *     This gate sets the preference through `emulateMedia`, asserts from
 *     inside the page that it took effect, and injects nothing.
 *
 *  2. IT REVEALED PANELS FROM SCRIPT. `revealAll()` flipped every
 *     `.phase-panel` to `phase-visible`, stripped every `[hidden]` attribute,
 *     and forced BOTH comparison panels to `display: block` — a rendering the
 *     page never produces (the naive/PIR toggle shows exactly one panel, and
 *     the claims suite asserts that). This gate reaches every panel by the
 *     route a reader has: selecting a book, pressing Query Privately, pressing
 *     the collusion button, clicking the comparison toggle.
 *
 *  3. IT SCANNED ONCE, AT THE END. The old `prepare()` drove the demo and
 *     revealed everything before its single scan per theme, so the arrival
 *     state (catalog previewing 4 of 8, visualizer idle, query button
 *     disabled), the selected-but-not-run state, the collusion panel both shut
 *     and open, the naive and PIR comparison sides, and every slider position
 *     were never measured. This drive names every control it touches, asserts
 *     a real completion signal after each, and scans after every step, in
 *     {dark, light} x {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. Almost every surface
 *     that carries meaning here is an `rgba()` fill or a `color-mix()` — the
 *     genre pills, the correctness badge, `.btn-secondary` and `.btn-danger`,
 *     the differing-bit note, the privacy conclusion, the collusion block and
 *     verdict, the survivor columns in the cancellation grid, the hero-why
 *     aside — and three whole sections paint `radial-gradient` washes. axe
 *     files all of them under `incomplete` rather than judging them. So does
 *     an `aria-label` on a role-less element, which this page shipped one of
 *     (`.hero-diagram`).
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR KEYBOARD-SCROLLER ORACLE. axe has
 *     no rule for WCAG 1.4.10 or 1.4.11 at all. This page has three
 *     `overflow-x: auto` containers (`#cancellation-grid`, the two `.cmp-code`
 *     request lines, `.xor-chain-container`), two of which genuinely scroll at
 *     380px, and until this gate landed none of them had a keyboard route in —
 *     and `.btn-outline` and `.btn-danger` drew their control boundary in a
 *     6%-alpha and 40%-alpha edge that dissolved into the panel behind them.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * A transition sampled mid-flight has a colour that exists in no state of the
 * page, and axe will happily report it. Transitions drain in waves rather than
 * in one batch, so six consecutive quiet frames are required rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css` caps every
 * animation and transition at 0.01ms rather than removing them, so
 * `getAnimations()` can briefly report a dying animation (`phaseReveal`,
 * `badgePop`) and this drains it. The protocol's own pacing is a `setTimeout`
 * chain in `visualizer.ts` that the Animation API cannot see at all — which is
 * why the drive additionally waits on real DOM completion signals (the final
 * book title filling in, the correctness badge appearing) rather than on this
 * alone.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state. THIS PAGE HAS THE
 * EXACT SHAPE: `renderBitmask()` parks each bit square at inline `opacity: 0`
 * until `bitAppear`'s `forwards` fill lands. Two separate belts keep that
 * safe — the JS stagger branch is skipped entirely when `matchMedia` matches,
 * and the reduced-motion block declares `.bit-square { opacity: 1 !important }`
 * for the case where only the CSS half is in effect — and this check is what
 * makes both of those a measurement rather than a reading. The block's other
 * declarations were read line by line: it caps `animation-duration`,
 * `animation-iteration-count` and `transition-duration` and restores
 * `scroll-behavior`, and touches no other `opacity`, `display` or `transform`.
 *
 * `aria-hidden` subtrees are excluded; see the note on `ariaHidden` in
 * `contrast.ts` for what this lab hides and why it was checked by hand.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. `startRun()` releases its re-entrancy lock in a `.finally`, so a
 * protocol animation that throws partway still re-enables the query button and
 * leaves a plausible-looking page behind — the rejection surfaces ONLY as a
 * `pageerror`. Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // One narrowly-scoped exclusion: Google's font CDN intermittently 404s a
    // woff2 the css2 response itself referenced. That is outside this repo —
    // the page falls back to the next stack in --font-mono/--font-heading and
    // every oracle here is font-independent — and it was flaking a different
    // test on each run. Scoped to the two font hosts by the message's source
    // URL, so a 404 on any LOCAL resource still fails the gate.
    const src = m.location()?.url ?? '';
    if (/^https:\/\/fonts\.(gstatic|googleapis)\.com\//.test(src)) return;
    errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * This page ships two `<header>`s that both DECLARE `role="banner"`: the
 * shared `.cl-topbar` and the lab's own `.site-header`. A third `<header>`
 * (`.cl-hero`) sits inside `<main>`, so it implies nothing. The single banner
 * therefore depends entirely on the shared bar's `dedupeBanner()` demoting
 * `.site-header` to `role="group"` on `DOMContentLoaded`, before the deferred
 * module script has necessarily run. Asserting the OUTCOME rather than the
 * mechanism is what catches a change to that ordering.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * An explicit role on a `<ul>`/`<ol>` REPLACES its implicit `list` role,
 * orphaning every `<li>` under it — and a redundant `role="list"` makes axe
 * apply `aria-required-children`, which fails whenever the list is empty.
 * Neither is reliably visible to a source grep, because a role can be assigned
 * as a JS property in an element-creation helper. Ask the DOM.
 *
 * This lab's one list is the OTHER shape: `#catalog-grid` is a `<div>` with an
 * explicit `role="list"` whose children `main.ts` stamps `role="listitem"` —
 * legitimate, and `aria-required-children` polices it through the axe run in
 * `scan()`. It is never empty (4 cards previewing, 8 expanded), which is a
 * property of `renderCatalog`, not of the markup — and is why the axe rule
 * stays cheap to keep live.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els.map(
      (e) => `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
    )
  );
  expect(broken, 'an explicit role on a list deletes its list semantics').toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including
 * the lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. That assertion is load-bearing in this repo
 * beyond the usual: `visualizer.ts` branches on `matchMedia` in JavaScript
 * (see the header), so if the emulation silently failed the gate would scan
 * the staggered animation while claiming to scan the reduced-motion rendering.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which pins down a real failure mode as a side effect: the anti-flash
 * script in `index.html` reads `localStorage.getItem('theme')`, the shared
 * bar's toggle writes `localStorage.setItem('theme', …)`, and this lab ALSO
 * has a toggle of its own in `main.ts` reading and writing the same key. All
 * three agree on `'theme'`; if any drifted, this boot fails on `data-theme`
 * rather than quietly scanning dark twice.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  // `main.ts` populates the catalog grid at module load; a module that threw
  // leaves the grid empty, and an empty grid is exactly what a scan reports as
  // perfectly accessible.
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.locator('.book-card')).toHaveCount(4);

  // The one skip link exists, points at an id that exists, and that target can
  // actually take focus (`tabindex="-1"` on `<main>` — without it the browser
  // scrolls but leaves focus on the link). axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('main#main-content')).toHaveAttribute('tabindex', '-1');

  // ── The lab's own theme toggle is hidden, AND actually hidden ───────────
  // The shared bar hides every lab's in-page toggle with
  // `body :is(#theme-toggle,…) { display: none !important }`
  // and leaves the element in the DOM so the lab's theme JS keeps working. That
  // is only correct if it is genuinely removed: `opacity: 0` with
  // `pointer-events: none` would leave a `<button>` tabbable and invisible.
  // Measured from the live element by trying to focus it.
  expect(
    await page.evaluate(() => {
      const t = document.getElementById('theme-toggle');
      if (!t) return 'the lab theme toggle is missing entirely';
      t.focus();
      return document.activeElement === t ? 'it took focus while hidden' : 'ok';
    }),
    'the lab own theme toggle must be hidden in a way that also removes it from the tab order'
  ).toBe('ok');

  // ── Every shipped default ───────────────────────────────────────────────
  // Which half of this lab a scan sees depends entirely on these. Nothing in
  // the visualizer exists until a book is selected AND queried, so the arrival
  // rendering is: 4 of 8 cards, the query button disabled, the idle hint the
  // only visible phase panel, the collusion panel absent, the NAIVE side of
  // the comparison showing its placeholder, and the scaling slider at 10^4.
  await expect(page.locator('#catalog-toggle-btn')).toHaveText('Showing 4 of 8 — show all');
  await expect(page.locator('#query-btn')).toBeDisabled();
  await expect(page.locator('#selected-title-text')).toContainText('No book selected');
  await expect(page.locator('#phase-idle')).toBeVisible();
  await expect(page.locator('.phase-panel.phase-hidden')).toHaveCount(5);
  await expect(page.locator('#collusion-attack')).toBeHidden();
  await expect(page.locator('#toggle-naive')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#naive-panel')).toBeVisible();
  await expect(page.locator('#pir-panel')).toBeHidden();
  await expect(page.locator('#scaling-slider')).toHaveValue('4');
  await expect(page.locator('#scaling-n-label')).toHaveText('10,000');
  await expect(page.locator('#scaling-sqrt')).toHaveText('100');
  // The mask-space prose is computed from DB_SIZE, not hardcoded — assert the
  // computed values so a silent init failure cannot leave the claim blank.
  await expect(page.locator('#mask-width')).toHaveText('8');
  await expect(page.locator('#mask-space-size')).toHaveText('256');

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling (WCAG 1.4.10, AA).
 *
 * axe has no rule for this at all. `style.css` deliberately does NOT set
 * `overflow-x: hidden` on `<body>` — its own comment explains that doing so
 * would clip wide content rather than fit it AND make this exact check pass by
 * construction (`scrollWidth === clientWidth` however wide the content is), so
 * the check stays falsifiable.
 *
 * Only elements that push the DOCUMENT sideways are named. A wide box inside
 * an `overflow: auto` wrapper has a huge bounding rect but is clipped by its
 * scroller and contributes nothing — naming it sends you off fixing the wrong
 * element. `.cancel-wrap` (`width: max-content` inside the scrolling
 * `#cancellation-grid`) and the request line inside each `.cmp-code` are
 * exactly such decoys at 380px.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab has three `overflow-x: auto` containers and the assertion is on the
 * OUTCOME because they are satisfied three different ways. `#cancellation-grid`
 * holds a `width: max-content` table of cancellation columns that genuinely
 * scrolls at 380px — it carries `tabindex="0"`, `role="region"` and an
 * `aria-label` (added by the same pass that added this gate; before it, the
 * grid was `aria-hidden` with no keyboard route at all). Each `.cmp-code`
 * request line is a single `white-space: nowrap` run that overflows at 380px —
 * both carry `tabindex="0"`. `.xor-chain-container` wraps its terms
 * (`flex-wrap: wrap; word-break: break-all`), so it does not normally overflow
 * and the requirement does not normally exist for it — if it ever does, this
 * names it.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * its tab stop, so a keyboard reader tabs to a control that is not on screen.
 * `display: none` and `visibility: hidden` DO remove an element from the tab
 * order, so those are skipped rather than flagged — the failure is
 * specifically the invisible-but-tabbable pair.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: `.cl-skip-link` parks at `top: -3rem` with full
 * opacity and a real box, and slides into view on focus — the drive scans it
 * focused. The tabbable population here is otherwise the buttons, the links,
 * the range slider, the 4-or-8 book cards (`tabindex="0"` from `renderCatalog`),
 * and the two scroll targets named in `expectScrollersReachable`.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a pseudo
 * glyph. Called from `scan()`, deliberately: fleet-wide this oracle had been
 * called from behind a `if (!COLLECTING) return` guard, so in a strict run —
 * every run anyone reads as a pass — it never executed at all. Calling it here
 * means it runs at every driven state, including `:hover`.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Eight assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because almost every
 *    meaningful surface is an `rgba()` fill or a `color-mix()`: the genre
 *    pills, the correctness badge, `.btn-secondary`/`.btn-danger`, the
 *    differing-bit note, the privacy conclusion, the collusion block, the
 *    survivor columns, the hero-why aside — and three sections paint
 *    `radial-gradient` washes. axe resolves none of them. Everything else in
 *    that bucket is a real result — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less element hides. This page shipped
 *    exactly that defect on `.hero-diagram` (a bare `<div aria-label>`), fixed
 *    with `role="group"` in the same pass that added this gate; the mask
 *    containers pair theirs with `role="img"` and the cancellation grid pairs
 *    its with `role="region"`. Drop any of those roles and the label is
 *    silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: two `<header role="banner">`s deduped at
  // runtime, a third `<header>` inside `<main>` with an `<aside>` inside it,
  // and two `<nav>`s that must stay distinguishable by label.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Run the protocol once and prove it both STARTED and FINISHED.
 *
 * `startRun()` opens with `if (selectedBook === null || isRunning) return`, so
 * a click that lands while a run is in flight SILENTLY DOES NOTHING. And the
 * completion signals are ambiguous on a re-run: `#final-book-title` and the
 * correctness badge keep their PREVIOUS run's content until the new run
 * repaints them, so "the title is non-empty" is satisfied before the second
 * run has done anything at all.
 *
 * So the start is latched, not assumed: a `MutationObserver` armed before the
 * click waits for `#query-btn` to acquire `disabled`, which `runProtocol()`
 * sets synchronously on its own turn only — under the reduced motion this
 * gate asserts, the whole run takes well under a second, so polling for the
 * disabled state after the fact can miss it entirely. Completion is then the
 * button leaving the disabled state (released in `startRun`'s `.finally`),
 * followed by assertions on content only a finished run renders.
 */
export async function runProtocol(page: Page, triggerId: string): Promise<void> {
  await page.evaluate(() => {
    const btn = document.getElementById('query-btn');
    if (!btn) throw new Error('no #query-btn');
    (window as unknown as { __runStarted?: boolean }).__runStarted = false;
    const obs = new MutationObserver(() => {
      if ((btn as HTMLButtonElement).disabled) {
        (window as unknown as { __runStarted?: boolean }).__runStarted = true;
        obs.disconnect();
      }
    });
    obs.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  });
  await page.locator(triggerId).click();
  await page.waitForFunction(
    () => (window as unknown as { __runStarted?: boolean }).__runStarted === true,
    undefined,
    { timeout: 20_000 }
  );
  await expect(page.locator('#query-btn')).toBeEnabled({ timeout: 60_000 });

  // Content only a finished run renders — all five phases at once, the two
  // masks with exactly one highlighted (differing) bit each, both XOR chains,
  // the reconstruction, and the correctness badge, whose text comes from the
  // run's own byte-for-byte comparison rather than from an assertion.
  await expect(page.locator('.phase-panel.phase-visible')).toHaveCount(5);
  await expect(page.locator('#phase-idle')).toBeHidden();
  await expect(page.locator('#mask-s1 .bit-square')).toHaveCount(8);
  await expect(page.locator('#mask-s2 .bit-square')).toHaveCount(8);
  await expect(page.locator('#mask-s1 .bit-highlight')).toHaveCount(1);
  await expect(page.locator('#mask-s2 .bit-highlight')).toHaveCount(1);
  await expect(page.locator('#xor-chain-s1')).not.toBeEmpty();
  await expect(page.locator('#xor-chain-s2')).not.toBeEmpty();
  await expect(page.locator('#final-book-title')).not.toHaveText('');
  await expect(page.locator('#correctness-badge')).toBeVisible();
  await expect(page.locator('#correctness-badge')).toContainText('Correct — r₁ ⊕ r₂ rebuilt all 64 bytes');
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED BEFORE ANYTHING IS DRIVEN: 4 of 8 catalog
 *    cards, the query button disabled, the visualizer idle, the collusion
 *    panel absent. The gate this replaces drove the demo and force-revealed
 *    every panel before its only scan, so the state every reader actually
 *    arrives in was never measured.
 *
 *  - EVERY PANEL IS REACHED BY THE READER'S ROUTE. The book is selected FROM
 *    THE KEYBOARD (focus + Enter — `renderCatalog` wires `keydown` for
 *    Enter/Space on each card, and this is what proves it), the query and
 *    collusion buttons are clicked, the comparison is flipped through its
 *    toggle, and the slider is driven with Home/End. Nothing is revealed from
 *    script.
 *
 *  - THE COLLUSION EXHIBIT IS VERIFIED, NOT JUST REVEALED. The recovered bit
 *    and title are asserted against the book that was selected — the exhibit's
 *    whole claim is that S ⊕ S′ names YOUR query.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves — and
 *    `.btn-primary:hover`, `.cl-btn:hover`, `.header-link:hover` and
 *    `.book-card:hover` all repaint fill or ink. Hover and focus-visible
 *    states are scanned explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: the
 *    query button leaving its disabled state, the correctness badge appearing,
 *    the collusion panel's `hidden` flipping, a slider readout reaching its
 *    computed wording.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: 4 of 8 cards, visualizer idle, query disabled');

  // ── The skip link, focused and slid into view ───────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the skip link focused, slid in from top:-3rem');

  // ── Catalog expanded to all 8 ───────────────────────────────────────────
  await page.locator('#catalog-toggle-btn').click();
  await expect(page.locator('.book-card')).toHaveCount(8);
  await expect(page.locator('#catalog-toggle-btn')).toHaveText('Show 4 of 8');
  await scanAt('catalog expanded to all 8 cards, the toggle still hovered from the click');

  // ── A book selected, from the keyboard ──────────────────────────────────
  // Card index 2 = "Atomic Habits"; the selection also fills the naive
  // comparison side with the URL-encoded search term the server would log.
  await page.locator('.book-card').nth(2).focus();
  await expect(page.locator('.book-card').nth(2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.book-card').nth(2)).toHaveClass(/selected/);
  await expect(page.locator('#selected-title-text')).toContainText('Selected: "Atomic Habits"');
  await expect(page.locator('#query-btn')).toBeEnabled();
  await expect(page.locator('#naive-query-text')).toHaveText('Atomic%20Habits');
  await scanAt('a book selected from the keyboard: card ring, armed query button, naive request line filled');

  // ── The full protocol run ───────────────────────────────────────────────
  await runProtocol(page, '#query-btn');
  await scanAt('full protocol run: masks, XOR chains, reconstruction, cancellation grid, privacy summary');

  // The keyboard route into the cancellation grid — the only scroller inside
  // the visualizer, and it genuinely scrolls at 380px.
  await page.locator('#cancellation-grid').focus();
  await expect(page.locator('#cancellation-grid')).toBeFocused();
  await scanAt('the cancellation grid focused — the keyboard route into its scroller');

  // ── The collusion attack, verified against the selected book ────────────
  await page.locator('#collude-btn').click();
  await expect(page.locator('#collusion-attack')).toBeVisible();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#collude-bit')).toHaveText('[2]');
  await expect(page.locator('#collude-title')).toHaveText('"Atomic Habits"');
  await scanAt('collusion attack revealed: S ⊕ S′ recovering exactly the selected index');

  // ── The PIR side of the comparison ──────────────────────────────────────
  // Populated by the run above; the naive side was scanned both empty (arrival)
  // and filled (selection).
  await page.locator('#toggle-pir').click();
  await expect(page.locator('#pir-panel')).toBeVisible();
  await expect(page.locator('#naive-panel')).toBeHidden();
  await expect(page.locator('#toggle-pir')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pir-mask-display')).toHaveText(/^[0-9a-f]{2}$/);
  await scanAt('the PIR side of the comparison: a mask where the naive side had a search term');
  await page.locator('#toggle-naive').click();
  await expect(page.locator('#naive-panel')).toBeVisible();
  await expect(page.locator('#pir-panel')).toBeHidden();

  // ── The scaling slider, driven from the keyboard to both ends ───────────
  await page.locator('#scaling-slider').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#scaling-n-label')).toHaveText('1,000,000');
  await expect(page.locator('#scaling-sqrt')).toHaveText('1,000');
  await expect(page.locator('#scaling-padding')).toContainText('holds exactly');
  await scanAt('scaling slider at 10^6, focus ring on the slider');

  await page.keyboard.press('Home');
  await expect(page.locator('#scaling-n-label')).toHaveText('10');
  // ceil(sqrt(10)) = 4: a 4x4 grid holds 16 cells, 6 of them padding — the
  // page says so instead of hiding it, and this pins that wording.
  await expect(page.locator('#scaling-sqrt')).toHaveText('4');
  await expect(page.locator('#scaling-padding')).toContainText('6 padding records');
  await scanAt('scaling slider at its minimum, the padding records called out');
  await page.locator('#scaling-slider').fill('4');

  // ── A second run over the same book ─────────────────────────────────────
  // The collusion panel was left open above; a new run retires it
  // (`resetCollusionDemo()` before phase 1), which the claims suite also pins.
  await runProtocol(page, '#run-again-btn');
  await expect(page.locator('#collusion-attack')).toBeHidden();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'false');
  await scanAt('a second run: fresh masks, the previous collusion result retired');

  // ── The finished run cleared back to idle ───────────────────────────────
  await page.locator('#new-book-btn').click();
  await expect(page.locator('#phase-idle')).toBeVisible();
  await expect(page.locator('.phase-panel.phase-hidden')).toHaveCount(5);
  await expect(page.locator('#collusion-attack')).toBeHidden();
  await scanAt('the finished run cleared back to idle by "Query a different book"');

  // ── Hover and focus-visible states on the controls that repaint ─────────
  await page.locator('.book-card').first().hover();
  await scanAt('a book card hovered, its border and fill repainted');

  await page.locator('#query-btn').hover();
  await scanAt('the primary query button hovered');

  await page.locator('.header-link').first().hover();
  await scanAt('a lab header link hovered');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  await page.locator('#catalog-toggle-btn').focus();
  await scanAt('a secondary button focused, showing its focus-visible outline');
}
