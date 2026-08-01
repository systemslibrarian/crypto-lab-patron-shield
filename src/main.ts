/**
 * patron-shield — main.ts
 * DOM wiring, event listeners, and state machine for the IT-PIR demo.
 */

import { CATALOG, DATABASE, DB_SIZE } from './catalog.ts';
import { runFullPIR, getSetBits, recoverByCollusion } from './pir.ts';
import type { PIRResult } from './types.ts';
import {
  renderBitmask,
  highlightBit,
  renderXORChain,
  renderHexBytes,
  renderCancellation,
  animateReveal,
  delay,
} from './visualizer.ts';

// ============================================================
// State
// ============================================================
type Phase = 'idle' | 'generating' | 'server1' | 'server2' | 'reconstruct' | 'done';
let currentPhase: Phase = 'idle';
let selectedBook: number | null = null;
// Most recent completed run — drives the collusion-attack demonstration.
let lastResult: PIRResult | null = null;
// Guards against overlapping protocol animations (rapid clicks / mid-run selection).
let isRunning = false;

type Theme = 'dark' | 'light';

// ============================================================
// DOM helpers
// ============================================================
function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} not found`);
  return e as T;
}

function showPhase(id: string): void {
  const panel = el(id);
  panel.classList.remove('phase-hidden');
  panel.classList.add('phase-visible');
}

function hidePhase(id: string): void {
  const panel = el(id);
  panel.classList.remove('phase-visible');
  panel.classList.add('phase-hidden');
}

function resetAllPhases(): void {
  ['phase-generating', 'phase-server1', 'phase-server2', 'phase-reconstruct', 'phase-done']
    .forEach(id => hidePhase(id));
  showPhase('phase-idle');
}

function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function updateThemeToggleButton(): void {
  const toggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement | null;
  if (!toggleBtn) return;

  const theme = getCurrentTheme();
  toggleBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
  toggleBtn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  );
}

function initThemeToggle(): void {
  const toggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement | null;
  if (!toggleBtn) return;

  updateThemeToggleButton();

  toggleBtn.addEventListener('click', () => {
    const nextTheme: Theme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    updateThemeToggleButton();
  });
}

// ============================================================
// Catalog rendering
// ============================================================
const PREVIEW_COUNT = 4;
let catalogExpanded = false;

function renderCatalog(): void {
  const grid = el('catalog-grid');
  grid.innerHTML = '';

  const visible = catalogExpanded ? CATALOG : CATALOG.slice(0, PREVIEW_COUNT);

  visible.forEach(book => {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Book ${book.id}: ${book.title} by ${book.author}`);
    card.dataset.id = String(book.id);

    card.innerHTML = `
      <div class="book-id-badge">#${String(book.id).padStart(2, '0')}</div>
      <div class="book-title">${book.title}</div>
      <div class="book-author">${book.author}</div>
      <span class="book-genre-pill">${book.genre}</span>
    `;

    card.addEventListener('click', () => selectBook(book.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectBook(book.id);
      }
    });

    grid.appendChild(card);
  });

  // Update toggle button
  const toggleBtn = el('catalog-toggle-btn');
  if (catalogExpanded) {
    toggleBtn.textContent = `Show ${PREVIEW_COUNT} of ${CATALOG.length}`;
  } else {
    toggleBtn.textContent = `Showing ${PREVIEW_COUNT} of ${CATALOG.length} — show all`;
  }
}

function selectBook(id: number): void {
  // Ignore selection changes while an animation is in flight — otherwise the
  // running sequence and the reset below race over the same DOM.
  if (isRunning) return;
  selectedBook = id;

  // Update card highlight
  document.querySelectorAll('.book-card').forEach(card => {
    card.classList.toggle('selected', (card as HTMLElement).dataset.id === String(id));
  });

  // Update status bar
  const book = CATALOG[id];
  el('selected-title-text').textContent = `Selected: "${book.title}" by ${book.author} (index ${id})`;

  // Enable query button
  const btn = el<HTMLButtonElement>('query-btn');
  btn.disabled = false;
  btn.setAttribute('aria-disabled', 'false');

  // Update naive comparison display
  el('naive-query-text').textContent = encodeURIComponent(book.title);

  // Reset visualizer if a previous run is showing
  if (currentPhase !== 'idle') {
    resetAllPhases();
    currentPhase = 'idle';
  }
}

// ============================================================
// Flash catalog cards for XOR visualization
// ============================================================
async function flashCards(indices: number[], serverClass: string): Promise<void> {
  const cards = document.querySelectorAll<HTMLElement>('.book-card');

  for (const idx of indices) {
    const card = cards[idx];
    if (!card) continue;
    card.classList.add(serverClass);
    await delay(120);
    card.classList.remove(serverClass);
    await delay(30);
  }
}

// ============================================================
// Main protocol animation sequence
// ============================================================
/**
 * Entry point for the two run triggers. Holds the re-entrancy lock and
 * guarantees it is released — and the query button re-enabled — even if the
 * animation throws partway through.
 */
function startRun(): void {
  if (selectedBook === null || isRunning) return;
  isRunning = true;
  runProtocol().finally(() => {
    isRunning = false;
    const btn = document.getElementById('query-btn') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
  });
}

async function runProtocol(): Promise<void> {
  if (selectedBook === null) return;

  // Expand catalog so flash animations can target all cards
  if (!catalogExpanded) {
    catalogExpanded = true;
    renderCatalog();
    // Re-highlight selected book
    document.querySelectorAll('.book-card').forEach(card => {
      card.classList.toggle('selected', (card as HTMLElement).dataset.id === String(selectedBook));
    });
  }

  currentPhase = 'generating';

  // Disable button during run
  const queryBtn = el<HTMLButtonElement>('query-btn');
  queryBtn.disabled = true;

  // Hide existing phases, show idle as cleared state
  resetAllPhases();
  hidePhase('phase-idle');

  // Collapse any prior collusion demonstration before the new run
  resetCollusionDemo();

  // Run the full PIR computation
  const result = runFullPIR(DATABASE, selectedBook);
  lastResult = result;

  const { query, response1, response2 } = result;
  const s1Bits = getSetBits(query.maskS);
  const s2Bits = getSetBits(query.maskSPrime);

  // ---- PHASE 1: Query generation ----
  showPhase('phase-generating');
  await delay(100);

  // Render bitmasks
  renderBitmask(el('mask-s1'), query.maskS, 'var(--color-s1)', true, DB_SIZE);
  renderBitmask(el('mask-s2'), query.maskSPrime, 'var(--color-s2)', true, DB_SIZE);

  // Wait for stagger animation to complete (DB_SIZE * 25ms + 80ms)
  await delay(DB_SIZE * 25 + 150);

  // Highlight differing bit
  highlightBit(el('mask-s1'), query.differingBit);
  highlightBit(el('mask-s2'), query.differingBit);

  // Show hex masks
  el('mask-s1-hex').textContent = '0x' + query.maskS.toString(16).padStart(Math.ceil(DB_SIZE / 4), '0');
  el('mask-s2-hex').textContent = '0x' + query.maskSPrime.toString(16).padStart(Math.ceil(DB_SIZE / 4), '0');
  el('differing-bit-num').textContent = String(query.differingBit);

  // Update PIR comparison panel
  el('pir-mask-display').textContent = query.maskS.toString(16).padStart(Math.ceil(DB_SIZE / 4), '0');

  await delay(800);

  // ---- PHASE 2: Server 1 ----
  currentPhase = 'server1';
  showPhase('phase-server1');
  await delay(200);

  renderXORChain(el('xor-chain-s1'), s1Bits, CATALOG, 'r₁');
  await flashCards(s1Bits, 'flash-s1');

  renderHexBytes(el('response1-hex'), response1, 'var(--color-s1)');
  await delay(600);

  // ---- PHASE 3: Server 2 ----
  currentPhase = 'server2';
  showPhase('phase-server2');
  await delay(200);

  renderXORChain(el('xor-chain-s2'), s2Bits, CATALOG, 'r₂');
  await flashCards(s2Bits, 'flash-s2');

  renderHexBytes(el('response2-hex'), response2, 'var(--color-s2)');
  await delay(600);

  // ---- PHASE 4: Reconstruction ----
  currentPhase = 'reconstruct';
  showPhase('phase-reconstruct');
  await delay(200);

  renderHexBytes(el('recon-r1-hex'), response1, 'var(--color-s1)');
  renderHexBytes(el('recon-r2-hex'), response2, 'var(--color-s2)');

  await delay(400);

  // Compute XOR result for display
  const xorResult = new Uint8Array(64);
  for (let k = 0; k < 64; k++) xorResult[k] = response1[k] ^ response2[k];
  renderHexBytes(el('recon-result-hex'), xorResult, 'var(--color-teal)');

  await delay(400);

  // Show *why* the XOR collapses to the target before revealing the title.
  renderCancellation(el('cancellation-grid'), s1Bits, s2Bits, selectedBook);
  el('cancel-target-idx').textContent = String(selectedBook);

  await delay(600);

  // Reveal title character by character
  const titleEl = el('title-reveal');
  await animateReveal(titleEl, result.reconstructed);

  // Show the correctness badge — driven by the run's own comparison of the
  // reconstructed string against CATALOG[targetIndex].title, never asserted. If
  // r1 XOR r2 ever failed to rebuild the record, this says so instead.
  const badge = el('correctness-badge');
  if (result.isCorrect) {
    badge.textContent = '✓ Correct — r₁ ⊕ r₂ rebuilt the exact book';
    badge.style.color = '';
    badge.style.background = '';
    badge.style.borderColor = '';
  } else {
    badge.textContent =
      `⚠ Reconstruction FAILED — r₁ ⊕ r₂ gave "${result.reconstructed}", `
      + `expected "${CATALOG[selectedBook].title}"`;
    badge.style.color = 'var(--color-danger)';
    badge.style.background = 'transparent';
    badge.style.borderColor = 'var(--color-danger)';
  }
  badge.style.display = 'inline-block';

  await delay(500);

  // ---- PHASE 5: Privacy proof ----
  currentPhase = 'done';
  showPhase('phase-done');
  await delay(100);

  // Server 1 indices
  el('s1-indices').textContent = s1Bits.length > 0
    ? s1Bits.map(i => `[${i}]`).join(' ') 
    : '(empty set)';
  el('s1-count').textContent = `${s1Bits.length} of ${DB_SIZE} slots set`;

  // Server 2 indices
  el('s2-indices').textContent = s2Bits.length > 0
    ? s2Bits.map(i => `[${i}]`).join(' ')
    : '(empty set)';
  el('s2-count').textContent = `${s2Bits.length} of ${DB_SIZE} slots set`;

  el('final-book-title').textContent = result.reconstructed;

  // Re-enable query button
  queryBtn.disabled = false;
}

// ============================================================
// Collusion attack demonstration
// ============================================================
const hexMask = (m: number): string =>
  '0x' + (m >>> 0).toString(16).padStart(Math.ceil(DB_SIZE / 4), '0');

function resetCollusionDemo(): void {
  const panel = document.getElementById('collusion-attack');
  const btn = document.getElementById('collude-btn') as HTMLButtonElement | null;
  if (panel) panel.hidden = true;
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Simulate the servers colluding →';
  }
}

function revealCollusionDemo(): void {
  if (!lastResult) return;
  const { maskS, maskSPrime } = lastResult.query;
  const recovered = recoverByCollusion(maskS, maskSPrime);

  el('collude-s1').textContent = hexMask(maskS);
  el('collude-s2').textContent = hexMask(maskSPrime);
  el('collude-diff').textContent = hexMask(maskS ^ maskSPrime);
  el('collude-bit').textContent = `[${recovered}]`;
  el('collude-title').textContent =
    recovered >= 0 ? `"${CATALOG[recovered].title}"` : '(unknown)';

  el('collusion-attack').hidden = false;
  const btn = el<HTMLButtonElement>('collude-btn');
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Servers colluded — query exposed';
}

// ============================================================
// Scaling section — feel the N vs √N gap
// ============================================================
function initScalingSlider(): void {
  const slider = document.getElementById('scaling-slider') as HTMLInputElement | null;
  if (!slider) return;

  const fmt = (n: number): string => n.toLocaleString('en-US');

  const update = (): void => {
    const exp = Number(slider.value);        // 1..6
    const n = Math.pow(10, exp);             // catalog size
    const root = Math.round(Math.sqrt(n));   // √N query (matrix scheme)
    const factor = Math.round(n / root);     // ≈ √N shrink

    el('scaling-n-label').textContent = fmt(n);
    el('scaling-linear').textContent = fmt(n);
    el('scaling-sqrt').textContent = fmt(root);
    el('scaling-factor').textContent = fmt(factor);
  };

  slider.addEventListener('input', update);
  update();
}

// ============================================================
// Event listeners
// ============================================================
function initEventListeners(): void {
  // Collusion attack toggle
  el('collude-btn').addEventListener('click', () => {
    const panel = el('collusion-attack');
    if (panel.hidden) {
      revealCollusionDemo();
    } else {
      resetCollusionDemo();
    }
  });

  // Catalog toggle
  el('catalog-toggle-btn').addEventListener('click', () => {
    if (isRunning) return; // don't re-render the grid out from under a running animation
    catalogExpanded = !catalogExpanded;
    const prevSelected = selectedBook;
    renderCatalog();
    if (prevSelected !== null) {
      document.querySelectorAll('.book-card').forEach(card => {
        card.classList.toggle('selected', (card as HTMLElement).dataset.id === String(prevSelected));
      });
    }
  });

  // Query button
  el('query-btn').addEventListener('click', startRun);

  // Run again
  el('run-again-btn').addEventListener('click', startRun);

  // Query different book
  el('new-book-btn').addEventListener('click', () => {
    resetAllPhases();
    resetCollusionDemo();
    currentPhase = 'idle';
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Naive / PIR toggle
  const toggleNaive = el('toggle-naive');
  const togglePir = el('toggle-pir');
  const naivePanel = el('naive-panel');
  const pirPanel = el('pir-panel');

  toggleNaive.addEventListener('click', () => {
    toggleNaive.classList.add('toggle-active');
    toggleNaive.setAttribute('aria-pressed', 'true');
    togglePir.classList.remove('toggle-active');
    togglePir.setAttribute('aria-pressed', 'false');
    naivePanel.style.display = 'block';
    pirPanel.style.display = 'none';
  });

  togglePir.addEventListener('click', () => {
    togglePir.classList.add('toggle-active');
    togglePir.setAttribute('aria-pressed', 'true');
    toggleNaive.classList.remove('toggle-active');
    toggleNaive.setAttribute('aria-pressed', 'false');
    pirPanel.style.display = 'block';
    naivePanel.style.display = 'none';
  });
}

// ============================================================
// Self-audit / adversarial tests (run in dev mode)
// ============================================================
function runSelfAudit(): void {
  const testIndices = [0, 3, 5, 7];
  let allPassed = true;

  for (const i of testIndices) {
    const r = runFullPIR(DATABASE, i);
    if (!r.isCorrect) {
      console.error(`[patron-shield AUDIT FAIL] index ${i}: got "${r.reconstructed}", expected "${CATALOG[i].title}"`);
      allPassed = false;
    }
    // Verify mask XOR invariant
    const xorCheck = r.query.maskS ^ r.query.maskSPrime;
    const expected = 1 << i;
    if (xorCheck !== expected) {
      console.error(`[patron-shield AUDIT FAIL] index ${i}: maskS ^ maskSPrime = ${xorCheck}, expected ${expected}`);
      allPassed = false;
    }
    // Verify the collusion attack recovers exactly the queried index —
    // the concrete failure the non-collusion assumption is there to prevent.
    const recovered = recoverByCollusion(r.query.maskS, r.query.maskSPrime);
    if (recovered !== i) {
      console.error(`[patron-shield AUDIT FAIL] index ${i}: collusion recovered ${recovered}, expected ${i}`);
      allPassed = false;
    }
  }

  // 100-iteration randomness test for index 3
  for (let run = 0; run < 100; run++) {
    const r = runFullPIR(DATABASE, 3);
    if (!r.isCorrect) {
      console.error(`[patron-shield AUDIT FAIL] randomness test run ${run}: got "${r.reconstructed}"`);
      allPassed = false;
      break;
    }
  }

  if (allPassed) {
    console.log(`[patron-shield] Self-audit passed ✓ — DATABASE.length=${DATABASE.length}, all correctness checks OK`);
  }
}

// ============================================================
// Bootstrap
// ============================================================
renderCatalog();
initThemeToggle();
initScalingSlider();
initEventListeners();

// Development self-audit
try {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isDev) runSelfAudit();
} catch (_) { /* ignore */ }
