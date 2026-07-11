import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the PIR correctness
 * self-audit; this gates them on accessibility the same way. Scans the full
 * page with every collapsible/panel expanded and the live PIR demo driven, in
 * both themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Kill animations/transitions so nothing is mid-flight (opacity 0, off-screen)
// when axe reads computed colors.
async function neutralizeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{transition:none!important;animation:none!important}`,
  });
}

// Reveal every class-toggled / [hidden] / display:none panel this page uses so
// their contents get scanned. There are no <details>; panels are class-toggled.
async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Native <details>, if any ever get added.
    for (const d of document.querySelectorAll('details')) {
      (d as HTMLDetailsElement).open = true;
    }
    // Protocol phase panels (class-toggled visibility).
    for (const p of document.querySelectorAll('.phase-panel')) {
      p.classList.remove('phase-hidden');
      p.classList.add('phase-visible');
    }
    // Collusion attack region + any [hidden] element.
    for (const h of document.querySelectorAll('[hidden]')) {
      h.removeAttribute('hidden');
    }
    // Comparison tabs: force both panels visible (JS toggles display:none).
    for (const id of ['naive-panel', 'pir-panel']) {
      const el = document.getElementById(id);
      if (el) (el as HTMLElement).style.display = 'block';
    }
  });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

// Drive the interactive PIR demo end-to-end so dynamically-injected result
// regions (bitmasks, XOR chains, reconstruction, privacy summary, collusion
// operands) exist in the DOM before scanning.
async function driveDemo(page: Page): Promise<void> {
  // Select the first book card, then run the query.
  await page.locator('.book-card').first().click();
  const queryBtn = page.locator('#query-btn');
  await expect(queryBtn).toBeEnabled();
  await queryBtn.click();
  // Wait for the run to complete: the final book title fills in at phase-done.
  await expect(page.locator('#final-book-title')).not.toHaveText('', {
    timeout: 30_000,
  });
  // Trigger the collusion attack so its operand region is populated + visible.
  await page.locator('#collude-btn').click();
  await expect(page.locator('#collusion-attack')).toBeVisible();
  // Flip the comparison tab to the PIR panel so its content is realized too.
  await page.locator('#toggle-pir').click();
}

async function prepare(page: Page): Promise<void> {
  await page.goto('.');
  // Shared header toggle is wired at runtime; wait for the app + toggle.
  await expect(page.locator('#cl-theme-toggle')).toBeVisible();
  await expect(page.locator('.book-card').first()).toBeVisible();
  await neutralizeMotion(page);
  await driveDemo(page);
  await revealAll(page);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await prepare(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await prepare(page);
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await scan(page);
});
