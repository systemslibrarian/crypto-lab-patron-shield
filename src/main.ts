/**
 * patron-shield — main.ts
 * DOM wiring, event listeners, and state machine for the IT-PIR demo.
 */

import { CATALOG, DATABASE, DB_SIZE } from './catalog.ts';
import { runFullPIR, getSetBits } from './pir.ts';
import {
  renderBitmask,
  highlightBit,
  renderXORChain,
  renderHexBytes,
  animateReveal,
  delay,
} from './visualizer.ts';

// ============================================================
// State
// ============================================================
type Phase = 'idle' | 'generating' | 'server1' | 'server2' | 'reconstruct' | 'done';
let currentPhase: Phase = 'idle';
let selectedBook: number | null = null;

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

// ============================================================
// Catalog rendering
// ============================================================
const PREVIEW_COUNT = 8;
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

  // Run the full PIR computation
  const result = runFullPIR(DATABASE, selectedBook);

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

  // Reveal title character by character
  const titleEl = el('title-reveal');
  await animateReveal(titleEl, result.reconstructed);

  // Show correctness badge
  const badge = el('correctness-badge');
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
// Event listeners
// ============================================================
function initEventListeners(): void {
  // Catalog toggle
  el('catalog-toggle-btn').addEventListener('click', () => {
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
  el('query-btn').addEventListener('click', () => {
    if (selectedBook !== null) {
      void runProtocol();
    }
  });

  // Run again
  el('run-again-btn').addEventListener('click', () => {
    if (selectedBook !== null) {
      void runProtocol();
    }
  });

  // Query different book
  el('new-book-btn').addEventListener('click', () => {
    resetAllPhases();
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
initEventListeners();

// Development self-audit
try {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isDev) runSelfAudit();
} catch (_) { /* ignore */ }
