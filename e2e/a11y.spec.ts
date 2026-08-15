import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where the
 * catalog previews 4 of 8 books, the query button is disabled and the
 * visualizer shows only its idle hint; the skip link focused and slid into
 * view; the catalog expanded to all 8 cards; a book selected FROM THE KEYBOARD
 * (focus + Enter), which arms the query button and fills the naive comparison
 * side with the search term a logging server would see; the full IT-PIR run —
 * both masks with their one differing bit highlighted, the two XOR chains, the
 * byte-wise reconstruction, the cancellation grid and the privacy summary —
 * with the run proved to have STARTED (a latch on the query button's disabled
 * attribute) and not merely finished; the cancellation grid focused, which is
 * the keyboard route into its scroller at 380px; the collusion attack
 * revealed and VERIFIED to recover exactly the selected index and title; the
 * PIR side of the comparison; the scaling slider driven with Home/End to both
 * ends, including the padding-records wording at N=10; a second run, which
 * must retire the previous collusion result; the theme switched live through
 * the shared bar with the full run on screen; the run cleared back to idle;
 * and hover and focus-visible states on the controls that repaint. Every one
 * of those states is scanned, in both themes, at desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (the old gate's
 * `addStyleTag` motion kill defeated the bit squares' `forwards` fill and
 * scanned both query masks invisible, and `visualizer.ts` branches on
 * `matchMedia`, which a style tag cannot reach), why no panel is revealed from
 * script, why the lab's defaults are asserted rather than assumed, and why
 * `violations` is not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
