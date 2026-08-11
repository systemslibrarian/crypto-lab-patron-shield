import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Functional gate for the claims this page makes on screen.
 *
 * The a11y suite proves the visualizer is reachable; this one proves its numbers
 * agree. Every check is one page-computed value against another: the two hex
 * masks against the differing-bit index the page printed, the reconstruction hex
 * against the two server responses it XORed, the reconstructed title's bytes
 * against that hex, the privacy counters against the index lists beside them,
 * and the collusion attack's recovered book against the one that was requested.
 */

// ---------------------------------------------------------------- guards

function guardPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  (test.info() as unknown as { _pageErrors: string[] })._pageErrors = guardPageErrors(page);
  // Reduced motion collapses the staggered pacing without skipping any phase,
  // so the whole protocol runs in about a second.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async () => {
  const errors = (test.info() as unknown as { _pageErrors?: string[] })._pageErrors ?? [];
  expect(errors, 'page must raise no uncaught exceptions or console errors').toEqual([]);
});

// ---------------------------------------------------------------- helpers

async function text(loc: Locator): Promise<string> {
  return ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** "0x3f" → 0x3f. */
async function hexValue(page: Page, id: string): Promise<number> {
  const raw = await text(page.locator(`#${id}`));
  const m = /^0x([0-9a-f]+)$/.exec(raw);
  expect(m, `#${id} is not a hex mask: ${raw}`).not.toBeNull();
  return parseInt(m![1], 16);
}

/** "0x3f a2 00 …" → [0x3f, 0xa2, 0x00]. */
async function hexBytes(page: Page, id: string): Promise<number[]> {
  const raw = await text(page.locator(`#${id} .hex-display`));
  const m = /^0x((?:[0-9a-f]{2} ?)+)/.exec(raw);
  expect(m, `#${id} is not a hex byte run: ${raw}`).not.toBeNull();
  return m![1]
    .trim()
    .split(/\s+/)
    .map((b) => parseInt(b, 16));
}

/**
 * The first `len` bytes of a catalog record as the database encodes it:
 * UTF-8 title in bytes 0–47, zero-padded. Lets the test recompute a server's
 * XOR sum from the titles on the cards, so "Server 1 XORed exactly the records
 * its chain names" is checked rather than assumed.
 */
function recordPrefix(title: string, len: number): number[] {
  const buf = new Uint8Array(64);
  buf.set(new TextEncoder().encode(title).slice(0, 48), 0);
  return Array.from(buf.slice(0, len));
}

function xorRecords(indices: number[], titles: string[], len: number): number[] {
  const acc = new Array<number>(len).fill(0);
  for (const i of indices) {
    const rec = recordPrefix(titles[i], len);
    for (let k = 0; k < len; k++) acc[k] ^= rec[k];
  }
  return acc;
}

function setBits(mask: number, n: number): number[] {
  const bits: number[] = [];
  for (let j = 0; j < n; j++) if ((mask >>> j) & 1) bits.push(j);
  return bits;
}

/** The "[0] [3] [7]" index list a privacy panel prints. */
async function indexList(page: Page, id: string): Promise<number[]> {
  const raw = await text(page.locator(`#${id}`));
  if (raw === '(empty set)') return [];
  return [...raw.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

/** Expand the catalog and read every book's index and title off the cards. */
async function catalogTitles(page: Page): Promise<string[]> {
  const btn = page.locator('#catalog-toggle-btn');
  if ((await text(btn)).includes('show all')) await btn.click();
  const cards = page.locator('#catalog-grid .book-card');
  const titles: string[] = [];
  for (let i = 0; i < (await cards.count()); i++) {
    titles.push(await text(cards.nth(i).locator('.book-title')));
  }
  return titles;
}

async function selectBook(page: Page, id: number): Promise<void> {
  await page.locator(`#catalog-grid .book-card[data-id="${id}"]`).click();
  await expect(page.locator(`#catalog-grid .book-card[data-id="${id}"]`)).toHaveClass(/selected/);
}

async function runProtocol(page: Page): Promise<void> {
  await page.locator('#query-btn').click();
  await expect(page.locator('#phase-done')).toHaveClass(/phase-visible/, { timeout: 30_000 });
  await expect(page.locator('#final-book-title')).not.toBeEmpty();
  await expect(page.locator('#query-btn')).toBeEnabled({ timeout: 30_000 });
}

const DB_SIZE = 8;
const RECORD_BYTES = 64;
/** The success verdict. It names the number of bytes it actually compared. */
const CORRECT_BADGE = `✓ Correct — r₁ ⊕ r₂ rebuilt all ${RECORD_BYTES} bytes of the stored record`;

// ---------------------------------------------------------------- tests

test('nothing runs until a book is chosen', async ({ page }) => {
  await page.goto('.');

  await expect(page.locator('#query-btn')).toBeDisabled();
  await expect(page.locator('#query-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#selected-title-text')).toHaveText(
    'No book selected. Click a card to begin.',
  );
  await expect(page.locator('#phase-idle')).toHaveClass(/phase-visible/);
  for (const id of ['phase-generating', 'phase-server1', 'phase-server2', 'phase-reconstruct', 'phase-done']) {
    await expect(page.locator(`#${id}`)).toHaveClass(/phase-hidden/);
  }
  await expect(page.locator('#collusion-attack')).toBeHidden();

  // Forcing the guarded button must not fabricate a run.
  await page.locator('#query-btn').click({ force: true });
  await expect(page.locator('#phase-done')).toHaveClass(/phase-hidden/);
});

test('selecting a book names it and arms the query', async ({ page }) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  expect(titles).toHaveLength(DB_SIZE);

  await selectBook(page, 5);

  const status = await text(page.locator('#selected-title-text'));
  expect(status).toContain(`"${titles[5]}"`);
  expect(status).toContain('(index 5)');
  await expect(page.locator('#query-btn')).toBeEnabled();
  await expect(page.locator('#catalog-grid .book-card.selected')).toHaveCount(1);

  // The "naive" comparison must quote the very query PIR is avoiding.
  expect(await text(page.locator('#naive-query-text'))).toBe(encodeURIComponent(titles[5]));

  // A different pick replaces the first, it does not add to it.
  await selectBook(page, 2);
  await expect(page.locator('#catalog-grid .book-card.selected')).toHaveCount(1);
  expect(await text(page.locator('#selected-title-text'))).toContain('(index 2)');
  expect(await text(page.locator('#naive-query-text'))).toBe(encodeURIComponent(titles[2]));
});

test('the two masks differ in exactly the bit the page says they do', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  const target = 3;
  await selectBook(page, target);
  await runProtocol(page);

  const s1 = await hexValue(page, 'mask-s1-hex');
  const s2 = await hexValue(page, 'mask-s2-hex');
  const differing = Number(await text(page.locator('#differing-bit-num')));

  expect(differing, 'the differing bit must be the index that was requested').toBe(target);
  expect(s1 ^ s2, 'S XOR S′ must be a single set bit at the target index').toBe(1 << differing);
  expect(s1).toBeLessThan(1 << DB_SIZE);
  expect(s2).toBeLessThan(1 << DB_SIZE);

  // The bit grids drawn for each mask must be the masks themselves.
  for (const [id, mask] of [
    ['mask-s1', s1],
    ['mask-s2', s2],
  ] as const) {
    const squares = page.locator(`#${id} .bit-square`);
    await expect(squares).toHaveCount(DB_SIZE);
    for (let i = 0; i < DB_SIZE; i++) {
      await expect(squares.nth(i), `${id} bit ${i}`).toHaveClass(
        new RegExp(`\\bbit-${(mask >>> i) & 1}\\b`),
      );
    }
    // ...and exactly one square, the differing one, carries the highlight ring.
    await expect(page.locator(`#${id} .bit-highlight`)).toHaveCount(1);
    await expect(squares.nth(differing)).toHaveClass(/bit-highlight/);
  }

  // The PIR-vs-naive panel quotes the mask that was actually sent.
  expect(await text(page.locator('#pir-mask-display'))).toBe(
    s1.toString(16).padStart(2, '0'),
  );
});

test('the reconstruction hex is the XOR of the two responses, and it is the title', async ({
  page,
}) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  const target = 6;
  await selectBook(page, target);
  await runProtocol(page);

  const r1 = await hexBytes(page, 'recon-r1-hex');
  const r2 = await hexBytes(page, 'recon-r2-hex');
  const out = await hexBytes(page, 'recon-result-hex');

  expect(r1.length).toBeGreaterThan(0);
  expect(r2.length).toBe(r1.length);
  expect(out.length).toBe(r1.length);

  // The headline arithmetic, recomputed here from the page's own two responses.
  expect(
    out,
    'the reconstruction line must be r1 XOR r2 byte for byte',
  ).toEqual(r1.map((b, i) => b ^ r2[i]));

  // Each server's own response panel must show the same bytes it contributed.
  expect(await hexBytes(page, 'response1-hex')).toEqual(r1);
  expect(await hexBytes(page, 'response2-hex')).toEqual(r2);

  // Each response must be the XOR of exactly the records that server's chain
  // names — recomputed here from the catalog on screen. Without this, a server
  // could XOR a completely different set of records and still reconstruct
  // correctly (the complement of S and the complement of S′ have the same
  // symmetric difference), while the chain on screen described a fiction.
  const chainIndices = async (id: string): Promise<number[]> =>
    (await page.locator(`#${id} .xor-term`).allTextContents()).map(
      (t) => Number(/db\[(\d+)\]/.exec(t.trim())![1]),
    );
  const b1 = await chainIndices('xor-chain-s1');
  const b2 = await chainIndices('xor-chain-s2');
  expect(b1, "Server 1's chain must be the set bits of the mask it was sent").toEqual(
    setBits(await hexValue(page, 'mask-s1-hex'), DB_SIZE),
  );
  expect(b2).toEqual(setBits(await hexValue(page, 'mask-s2-hex'), DB_SIZE));
  expect(r1, 'Server 1 must XOR exactly the records its chain lists').toEqual(
    xorRecords(b1, titles, r1.length),
  );
  expect(r2, 'Server 2 must XOR exactly the records its chain lists').toEqual(
    xorRecords(b2, titles, r2.length),
  );

  // ...and those XORed bytes must literally be the title that was revealed.
  const expectedTitle = titles[target];
  const titleBytes = Array.from(new TextEncoder().encode(expectedTitle)).slice(0, out.length);
  expect(
    out.slice(0, titleBytes.length),
    'the recovered bytes must be the UTF-8 of the recovered title',
  ).toEqual(titleBytes);

  expect(await text(page.locator('#title-reveal'))).toBe(expectedTitle);
  expect(await text(page.locator('#final-book-title'))).toBe(expectedTitle);

  // The verdict is the run's own comparison — and must not be the failure branch.
  const badge = page.locator('#correctness-badge');
  await expect(badge).toBeVisible();
  expect(await text(badge)).toBe(CORRECT_BADGE);
  expect(await text(badge)).not.toContain('FAILED');
  expect(await page.locator('#phase-reconstruct').innerText()).not.toContain('Reconstruction FAILED');
});

test('the download claim matches the number of responses the page shows', async ({ page }) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  await selectBook(page, 0);
  await runProtocol(page);

  // The client receives TWO record-sized XOR responses, not "one record's worth
  // of data" — and the page displays both of them, so the old sentence was
  // contradicted by an exhibit on the same page.
  const responses = ['response1-hex', 'response2-hex'];
  let recordSized = 0;
  for (const id of responses) {
    const bytes = await hexBytes(page, id);
    expect(bytes.length, `${id} must render bytes`).toBeGreaterThan(0);
    recordSized++;
  }
  expect(recordSized, 'the run must display two server responses').toBe(2);
  expect(titles).toHaveLength(DB_SIZE);

  const lead = await text(page.locator('.hero-why-lead'));
  expect(lead, 'the motivation must not claim a single record-sized transfer').not.toContain(
    "one record's worth of data",
  );
  expect(lead.toLowerCase()).toContain('two record-sized');

  // The success verdict must name the byte count it actually compared.
  expect(await text(page.locator('#correctness-badge'))).toBe(CORRECT_BADGE);
  expect(CORRECT_BADGE).toContain(String(RECORD_BYTES));
});

test('the cancellation grid survives exactly the requested record', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  const target = 1;
  await selectBook(page, target);
  await runProtocol(page);

  const s1 = await hexValue(page, 'mask-s1-hex');
  const s2 = await hexValue(page, 'mask-s2-hex');
  const union = [...new Set([...setBits(s1, DB_SIZE), ...setBits(s2, DB_SIZE)])].sort(
    (a, b) => a - b,
  );

  const cols = page.locator('#cancellation-grid .cancel-col');
  await expect(cols).toHaveCount(union.length);

  let survivors = 0;
  for (let i = 0; i < union.length; i++) {
    const idx = union[i];
    const col = cols.nth(i);
    expect(await text(col.locator('.cancel-label'))).toBe(`db[${idx}]`);

    const in1 = ((s1 >>> idx) & 1) === 1;
    const in2 = ((s2 >>> idx) & 1) === 1;
    // The dots must be the masks, not a decoration.
    expect(await text(col.locator('.cancel-cell').nth(0)), `db[${idx}] r1 dot`).toBe(
      in1 ? '●' : '·',
    );
    expect(await text(col.locator('.cancel-cell').nth(1)), `db[${idx}] r2 dot`).toBe(
      in2 ? '●' : '·',
    );

    const status = await text(col.locator('.cancel-status'));
    if (in1 !== in2) {
      survivors++;
      expect(status, `db[${idx}] is in exactly one sum, so it must survive`).toBe('✓ keeps');
      expect(idx, 'the only survivor must be the requested record').toBe(target);
    } else {
      expect(status, `db[${idx}] is in both sums, so it must cancel`).toBe('✕ cancels');
    }
  }
  expect(survivors, 'exactly one record may survive the XOR').toBe(1);
  expect(await text(page.locator('#cancel-target-idx'))).toBe(String(target));

  // The grid must never quietly show a survivor that is not the target.
  expect(await page.locator('#cancellation-grid').innerText()).not.toContain(
    'NOT the requested record',
  );
});

test('the privacy counters add up to the index lists beside them', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  const target = 4;
  await selectBook(page, target);
  await runProtocol(page);

  const s1 = await hexValue(page, 'mask-s1-hex');
  const s2 = await hexValue(page, 'mask-s2-hex');

  for (const [maskId, listId, countId, mask] of [
    ['s1', 's1-indices', 's1-count', s1],
    ['s2', 's2-indices', 's2-count', s2],
  ] as const) {
    const listed = await indexList(page, listId);
    // The list must be exactly the bits set in that server's mask.
    expect(listed, `${maskId}: the indices shown must be the mask's set bits`).toEqual(
      setBits(mask, DB_SIZE),
    );

    const count = await text(page.locator(`#${countId}`));
    const m = /^(\d+) of (\d+) slots set$/.exec(count);
    expect(m, `unparseable count: ${count}`).not.toBeNull();
    expect(Number(m![1]), `${maskId}: the count must be the indices it listed`).toBe(listed.length);
    expect(Number(m![2]), 'the denominator must be the database size').toBe(DB_SIZE);
    expect(listed.length).toBeLessThanOrEqual(DB_SIZE);
  }

  // Neither server's own view marks the target: the two views differ in exactly
  // one index, and only a party holding BOTH can see which.
  const b1 = await indexList(page, 's1-indices');
  const b2 = await indexList(page, 's2-indices');
  const symmetric = [...b1.filter((x) => !b2.includes(x)), ...b2.filter((x) => !b1.includes(x))];
  expect(symmetric, 'the two views must differ in exactly the requested index').toEqual([target]);

  // The XOR chains each server computed must be its own index list.
  const chain1 = await page.locator('#xor-chain-s1 .xor-term').allTextContents();
  expect(chain1.map((t) => Number(/db\[(\d+)\]/.exec(t.trim())![1]))).toEqual(b1);
  const chain2 = await page.locator('#xor-chain-s2 .xor-term').allTextContents();
  expect(chain2.map((t) => Number(/db\[(\d+)\]/.exec(t.trim())![1]))).toEqual(b2);
});

test('every book in the catalog is retrieved correctly', async ({ page }) => {
  test.slow();
  await page.goto('.');
  const titles = await catalogTitles(page);

  for (let i = 0; i < DB_SIZE; i++) {
    await selectBook(page, i);
    await runProtocol(page);

    expect(await text(page.locator('#final-book-title')), `book ${i}`).toBe(titles[i]);
    expect(await text(page.locator('#correctness-badge')), `book ${i}`).toBe(
      CORRECT_BADGE,
    );
    expect(Number(await text(page.locator('#differing-bit-num'))), `book ${i}`).toBe(i);
    const s1 = await hexValue(page, 'mask-s1-hex');
    const s2 = await hexValue(page, 'mask-s2-hex');
    expect(s1 ^ s2, `book ${i}`).toBe(1 << i);
  }
});

test('Run again redraws the mask but recovers the same book', async ({ page }) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  await selectBook(page, 7);
  await runProtocol(page);

  const seen: number[] = [];
  for (let run = 0; run < 4; run++) {
    if (run > 0) {
      await page.locator('#run-again-btn').click();
      await expect(page.locator('#phase-done')).toHaveClass(/phase-visible/, { timeout: 30_000 });
      await expect(page.locator('#query-btn')).toBeEnabled({ timeout: 30_000 });
    }
    seen.push(await hexValue(page, 'mask-s1-hex'));
    expect(await text(page.locator('#final-book-title'))).toBe(titles[7]);
    expect(await hexValue(page, 'mask-s1-hex') ^ (await hexValue(page, 'mask-s2-hex'))).toBe(
      1 << 7,
    );
  }
  expect(
    new Set(seen).size,
    'each run must draw a fresh mask (four identical 8-bit draws is ~2^-24)',
  ).toBeGreaterThan(1);
});

// ---------------------------------------------------------------- collusion

test('the collusion attack recovers exactly the book that was requested', async ({ page }) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  const target = 2;
  await selectBook(page, target);
  await runProtocol(page);

  const s1 = await hexValue(page, 'mask-s1-hex');
  const s2 = await hexValue(page, 'mask-s2-hex');

  await expect(page.locator('#collusion-attack')).toBeHidden();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#collude-btn').click();
  await expect(page.locator('#collusion-attack')).toBeVisible();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'true');
  expect(await text(page.locator('#collude-btn'))).toBe('Servers colluded — query exposed');

  // The panel must be showing the two masks the run actually used...
  expect(await hexValue(page, 'collude-s1')).toBe(s1);
  expect(await hexValue(page, 'collude-s2')).toBe(s2);
  const diff = await hexValue(page, 'collude-diff');
  expect(diff, 'the difference must be the XOR of the two masks').toBe(s1 ^ s2);
  expect(diff & (diff - 1), 'a valid query pair differs in exactly one bit').toBe(0);
  // Read the bit position the way the fixed engine does. This line used to call
  // Math.log2 — reproducing, in the test, the exact defect the panel had.
  expect(31 - Math.clz32(diff >>> 0)).toBe(target);

  // ...and it must name the book, not merely a bit index.
  expect(await text(page.locator('#collude-bit'))).toBe(`[${target}]`);
  expect(await text(page.locator('#collude-title'))).toBe(`"${titles[target]}"`);
  expect(await text(page.locator('#collude-title'))).not.toBe('(unknown)');

  // Toggling closes it again.
  await page.locator('#collude-btn').click();
  await expect(page.locator('#collusion-attack')).toBeHidden();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'false');
  expect(await text(page.locator('#collude-btn'))).toBe('Simulate the servers colluding →');
});

test('a new run retires the previous collusion result instead of leaving it up', async ({
  page,
}) => {
  await page.goto('.');
  const titles = await catalogTitles(page);
  await selectBook(page, 0);
  await runProtocol(page);
  await page.locator('#collude-btn').click();
  expect(await text(page.locator('#collude-title'))).toBe(`"${titles[0]}"`);

  // Query a different book: the exposed result for book 0 must not survive.
  await selectBook(page, 5);
  await runProtocol(page);
  await expect(page.locator('#collusion-attack')).toBeHidden();
  await expect(page.locator('#collude-btn')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#collude-btn').click();
  expect(await text(page.locator('#collude-title'))).toBe(`"${titles[5]}"`);
  expect(await text(page.locator('#collude-bit'))).toBe('[5]');
});

test('choosing a different book clears the finished run', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  await selectBook(page, 3);
  await runProtocol(page);
  await expect(page.locator('#phase-done')).toHaveClass(/phase-visible/);

  await selectBook(page, 6);
  await expect(page.locator('#phase-done')).toHaveClass(/phase-hidden/);
  await expect(page.locator('#phase-reconstruct')).toHaveClass(/phase-hidden/);
  await expect(page.locator('#phase-idle')).toHaveClass(/phase-visible/);
  expect(await text(page.locator('#selected-title-text'))).toContain('(index 6)');
});

// ---------------------------------------------------------------- other panels

test('the √N column mask can address every record, at every slider position', async ({ page }) => {
  await page.goto('.');
  const slider = page.locator('#scaling-slider');
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));

  const num = async (id: string): Promise<number> =>
    Number((await text(page.locator(`#${id}`))).replace(/,/g, ''));

  // This test used to recompute `Math.round(Math.sqrt(n))` — the same formula the
  // page used — so it checked internal consistency and could never see that the
  // grid was too small. The claim is a CAPACITY claim: a side-by-side grid whose
  // column mask is `side` bits holds side² records, and that must cover N.
  let nonSquare = 0;
  let roundWouldUnderCount = 0;
  for (let exp = min; exp <= max; exp++) {
    await slider.fill(String(exp));
    const n = 10 ** exp;
    expect(await num('scaling-n-label'), `exp ${exp}`).toBe(n);
    expect(await num('scaling-linear'), 'the linear cost is the whole catalog').toBe(n);

    const side = await num('scaling-sqrt');
    expect(side * side, `exp ${exp}: a ${side}x${side} grid must hold all ${n} records`)
      .toBeGreaterThanOrEqual(n);
    expect((side - 1) * (side - 1), `exp ${exp}: ${side} must be the SMALLEST such side`)
      .toBeLessThan(n);

    // Pin the specific regression: the positions where Math.round produced a
    // grid too small to hold the catalog must now show a strictly larger side.
    const rounded = Math.round(Math.sqrt(n));
    if (rounded * rounded < n) {
      roundWouldUnderCount++;
      expect(side, `exp ${exp}: round gave ${rounded} (${rounded * rounded} < ${n})`)
        .toBeGreaterThan(rounded);
    }

    // The shrink factor must be the ratio of the two figures printed beside it,
    // at the one-decimal precision the page prints (N=1000 gives exactly 31.25,
    // which is a rounding tie, so compare the rounded values rather than a delta).
    const factor = await num('scaling-factor');
    expect(factor, `exp ${exp}: the factor must be N / side`).toBe(
      Number((n / side).toFixed(1)),
    );

    // The padding line must state the true capacity, and say when it is not exact.
    const padding = await text(page.locator('#scaling-padding'));
    expect(padding, `exp ${exp}: padding note`).toContain(
      `${side.toLocaleString('en-US')} × ${side.toLocaleString('en-US')}`,
    );
    if (side * side === n) {
      expect(padding).toContain('exactly');
    } else {
      nonSquare++;
      expect(padding, `exp ${exp}: must name the padding records`).toContain(
        `${(side * side - n).toLocaleString('en-US')} padding records`,
      );
    }
  }
  // Three of the six positions (N = 10, 1,000, 100,000) are not perfect squares,
  // so the padding line has to be exercised. Two of those three (N = 10 and
  // N = 100,000) are where Math.round produced a grid too small to hold the
  // catalog. If the sweep hits neither case it is not testing the fix.
  expect(nonSquare, 'no slider position had a non-square N — the padding note is untested').toBe(3);
  expect(
    roundWouldUnderCount,
    'no slider position reproduced the Math.round undercount — the ceil fix is untested',
  ).toBe(2);

  // The figures are query bits; the page must say so rather than implying they
  // are the total cost. Each server still returns a record-sized response.
  const scope = await text(page.locator('.scaling-scope-note'));
  expect(scope.toLowerCase()).toContain('query bits only');
  expect(scope.toLowerCase()).toContain('response');
});

test('the naive / PIR toggle shows exactly one panel', async ({ page }) => {
  await page.goto('.');

  await expect(page.locator('#toggle-naive')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#naive-panel')).toBeVisible();
  await expect(page.locator('#pir-panel')).toBeHidden();

  await page.locator('#toggle-pir').click();
  await expect(page.locator('#toggle-pir')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toggle-naive')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#pir-panel')).toBeVisible();
  await expect(page.locator('#naive-panel')).toBeHidden();

  await page.locator('#toggle-naive').click();
  await expect(page.locator('#naive-panel')).toBeVisible();
  await expect(page.locator('#pir-panel')).toBeHidden();
});

test('the catalog toggle shows the count it claims to show', async ({ page }) => {
  await page.goto('.');
  const btn = page.locator('#catalog-toggle-btn');
  const cards = page.locator('#catalog-grid .book-card');

  const collapsed = await text(btn);
  const m = /Showing (\d+) of (\d+) — show all/.exec(collapsed);
  expect(m, `unparseable toggle label: ${collapsed}`).not.toBeNull();
  await expect(cards).toHaveCount(Number(m![1]));
  const total = Number(m![2]);

  await btn.click();
  await expect(cards).toHaveCount(total);
  expect(await text(btn)).toBe(`Show ${m![1]} of ${total}`);

  await btn.click();
  await expect(cards).toHaveCount(Number(m![1]));
});

test('a book can be chosen and queried from the keyboard alone', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  const titles = await catalogTitles(page);

  await page.locator('#catalog-grid .book-card[data-id="4"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-grid .book-card[data-id="4"]')).toHaveClass(/selected/);

  await page.locator('#query-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#phase-done')).toHaveClass(/phase-visible/, { timeout: 30_000 });
  // phase-done becomes visible ~100ms BEFORE #final-book-title is filled in, so
  // reading the text the instant the class lands raced and flaked (2 failures in
  // 6 observed runs). Wait for the value, then assert it.
  await expect(page.locator('#final-book-title')).toHaveText(titles[4], { timeout: 30_000 });
});

// ---------------------------------------------------------------- page claims

test('the skip link lands on the main region it names', async ({ page }) => {
  await page.goto('.');
  const skip = page.locator('.cl-skip-link');
  const href = await skip.getAttribute('href');
  expect(href, 'the skip link must name a fragment').toMatch(/^#.+/);

  // The whole point of the link is that the target EXISTS. It used to be "#app",
  // and this page has no #app — so "Skip to content" scrolled nowhere. axe does
  // not catch this: its skip-link rule is best-practice, not WCAG A/AA, so the
  // a11y suite passed over it.
  const targetId = href!.slice(1);
  await expect(page.locator(`#${targetId}`)).toHaveCount(1);

  // ...and activating it must actually move focus into that region, not merely
  // scroll. That needs the target to be programmatically focusable.
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
  expect(focusedId, 'activating the skip link must move focus to the main region').toBe(targetId);
  await expect(page.locator(`#${targetId}`)).toContainText('Library Catalog');
});

test('the page links to the repository it actually lives in', async ({ page }) => {
  await page.goto('.');
  const hrefs = await page.locator('a[href*="github.com/systemslibrarian"]').evaluateAll(
    (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
  );
  expect(hrefs.length, 'the page must carry at least one repository link').toBeGreaterThan(0);
  for (const h of hrefs) {
    expect(h, 'a header link pointed at the wrong repo (systemslibrarian/patron-shield)').toContain(
      'systemslibrarian/crypto-lab-patron-shield',
    );
  }
});

test('the visualizer says the servers are simulated in this one browser', async ({ page }) => {
  await page.goto('.');
  const note = await text(page.locator('#simulation-note'));
  expect(note.length, 'the simulation note must not be empty').toBeGreaterThan(0);
  expect(note.toLowerCase()).toContain('simulation');
  expect(note.toLowerCase()).toContain('browser');
});

test('privacy is scoped to the index, and correctness is not claimed from it', async ({ page }) => {
  await page.goto('.');
  await catalogTitles(page);
  await selectBook(page, 0);
  await runProtocol(page);

  // "learns nothing" must be scoped to WHICH record, and the metadata it does
  // not hide must be named on the same panel.
  const scope = await text(page.locator('.privacy-scope-note'));
  expect(scope.toLowerCase()).toContain('which record you requested');
  for (const leak of ['when', 'how often', 'response size']) {
    expect(scope.toLowerCase(), `metadata scope must name "${leak}"`).toContain(leak);
  }

  // The trust model must not present "at least one server is honest" as buying
  // correctness — a single malicious server corrupts r1 XOR r2 undetectably.
  const collusion = await text(page.locator('.collusion-scope'));
  expect(collusion.toLowerCase()).toContain('correctness');
  expect(collusion.toLowerCase()).toContain('both');
  const whole = await page.locator('#phase-done').innerText();
  expect(whole).not.toContain('the assumption that at least one server is honest');

  // The uniformity claim, not a "random-looking" one: the page teaches an
  // information-theoretic guarantee three panels up, and "random-looking" is a
  // computational-indistinguishability phrase that contradicts it.
  const conclusion = await text(page.locator('.privacy-conclusion'));
  expect(conclusion.toLowerCase()).toContain('uniformly random');
  const body = await page.locator('main').innerText();
  expect(body, 'no panel may describe the masks as merely random-looking').not.toMatch(
    /cryptographically random-looking|indistinguishable from random noise/,
  );
});

test('the query-space figure is computed from the database size, not hardcoded', async ({
  page,
}) => {
  await page.goto('.');
  const width = Number(await text(page.locator('#mask-width')));
  const space = Number((await text(page.locator('#mask-space-size'))).replace(/,/g, ''));
  expect(width, 'the mask width must be the database size').toBe(DB_SIZE);
  expect(space, 'the query space must be 2^width').toBe(2 ** DB_SIZE);
});
