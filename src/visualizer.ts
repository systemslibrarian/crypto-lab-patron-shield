/**
 * patron-shield — Bitmask Visualizer
 * Renders N-bit masks as animated bit-square grids and XOR chains.
 */

import type { Book } from './types.ts';

/**
 * True when the user has asked the OS to minimize animation.
 * Evaluated live so a mid-session preference change is respected.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Render an N-bit mask as a grid of bit squares.
 * Each square is 14×14px; 0-bits are dark, 1-bits use the provided color.
 * If animateIn=true, each square fades in with a staggered delay.
 */
export function renderBitmask(
  container: HTMLElement,
  mask: number,
  color: string,
  animateIn: boolean,
  numBits: number = 8
): void {
  container.innerHTML = '';
  container.style.setProperty('--server-color', color);

  const grid = document.createElement('div');
  grid.className = 'bit-grid';

  const stagger = animateIn && !prefersReducedMotion();

  for (let i = 0; i < numBits; i++) {
    const bit = (mask >>> i) & 1;
    const sq = document.createElement('div');
    sq.className = `bit-square bit-${bit}`;
    sq.dataset.index = String(i);

    if (bit === 1) {
      sq.style.background = color;
    }

    if (stagger) {
      sq.style.opacity = '0';
      sq.style.animationName = 'bitAppear';
      sq.style.animationDuration = '80ms';
      sq.style.animationTimingFunction = 'ease-out';
      sq.style.animationFillMode = 'forwards';
      sq.style.animationDelay = `${i * 25}ms`;
    }

    grid.appendChild(sq);
  }

  container.appendChild(grid);
}

/**
 * Add a bright ring to the bit square at position bitIndex.
 */
export function highlightBit(container: HTMLElement, bitIndex: number): void {
  const grid = container.querySelector('.bit-grid');
  if (!grid) return;
  const squares = grid.querySelectorAll('.bit-square');
  squares.forEach((sq, idx) => {
    if (idx === bitIndex) {
      (sq as HTMLElement).classList.add('bit-highlight');
    }
  });
}

/**
 * Renders the XOR computation chain showing which db indices contribute.
 * Example: "db[3] ⊕ db[7] ⊕ db[12] = r₁"
 * Shows abbreviated book titles in tooltips.
 */
export function renderXORChain(
  container: HTMLElement,
  indices: number[],
  books: Book[],
  resultLabel: string
): void {
  container.innerHTML = '';

  if (indices.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'xor-empty';
    empty.textContent = '(empty set) = 0x00…00';
    container.appendChild(empty);
    return;
  }

  const chain = document.createElement('div');
  chain.className = 'xor-chain';

  indices.forEach((idx, pos) => {
    if (pos > 0) {
      const op = document.createElement('span');
      op.className = 'xor-op';
      op.textContent = ' ⊕ ';
      chain.appendChild(op);
    }

    const term = document.createElement('span');
    term.className = 'xor-term';

    // Abbreviate title to ~12 chars
    const title = books[idx]?.title ?? `db[${idx}]`;
    const shortTitle = title.length > 12 ? title.slice(0, 12) + '…' : title;
    term.textContent = `db[${idx}]`;
    term.title = `db[${idx}]: "${title}"`;
    term.dataset.title = shortTitle;

    chain.appendChild(term);
  });

  const eq = document.createElement('span');
  eq.className = 'xor-eq';
  eq.textContent = ` = ${resultLabel}`;
  chain.appendChild(eq);

  container.appendChild(chain);
}

/**
 * Render first 8 bytes of a Uint8Array as hex pairs.
 * Example: "0x3f a2 00 7c 11 b3 42 08"
 */
export function renderHexBytes(
  container: HTMLElement,
  bytes: Uint8Array,
  color: string
): void {
  container.innerHTML = '';

  const hex = document.createElement('code');
  hex.className = 'hex-display';
  hex.style.color = color;

  const pairs: string[] = [];
  for (let i = 0; i < Math.min(8, bytes.length); i++) {
    pairs.push(bytes[i].toString(16).padStart(2, '0'));
  }
  hex.textContent = '0x' + pairs.join(' ') + (bytes.length > 8 ? ' …' : '');

  container.appendChild(hex);
}

/**
 * Render the correctness intuition for the reconstruct phase: a column per
 * record that appears in either server's XOR sum. Records present in BOTH
 * sums cancel (a ⊕ a = 0); the single record in the symmetric difference —
 * the target — is the only survivor. This is the "why it works" of XOR
 * reconstruction made visible.
 */
export function renderCancellation(
  container: HTMLElement,
  s1Bits: number[],
  s2Bits: number[],
  targetIndex: number
): void {
  container.innerHTML = '';
  const union = Array.from(new Set([...s1Bits, ...s2Bits])).sort((a, b) => a - b);

  const grid = document.createElement('div');
  grid.className = 'cancel-cols';

  for (const idx of union) {
    const in1 = s1Bits.includes(idx);
    const in2 = s2Bits.includes(idx);
    const survives = idx === targetIndex; // the one in exactly one set

    const col = document.createElement('div');
    col.className = 'cancel-col' + (survives ? ' cancel-col-survive' : '');

    const label = document.createElement('div');
    label.className = 'cancel-label';
    label.textContent = `db[${idx}]`;

    const r1 = document.createElement('div');
    r1.className = 'cancel-cell ' + (in1 ? 'cancel-on s1' : 'cancel-off');
    r1.textContent = in1 ? '●' : '·';

    const r2 = document.createElement('div');
    r2.className = 'cancel-cell ' + (in2 ? 'cancel-on s2' : 'cancel-off');
    r2.textContent = in2 ? '●' : '·';

    const status = document.createElement('div');
    status.className = 'cancel-status';
    status.textContent = survives ? '✓ keeps' : '✕ cancels';

    col.append(label, r1, r2, status);
    grid.appendChild(col);
  }

  // Row legend on the left
  const legend = document.createElement('div');
  legend.className = 'cancel-legend';
  legend.innerHTML =
    '<div class="cancel-legend-label">&nbsp;</div>' +
    '<div class="cancel-legend-label s1">r₁</div>' +
    '<div class="cancel-legend-label s2">r₂</div>' +
    '<div class="cancel-legend-label">&nbsp;</div>';

  const wrap = document.createElement('div');
  wrap.className = 'cancel-wrap';
  wrap.append(legend, grid);
  container.appendChild(wrap);
}

/**
 * Reveal text character-by-character, 40ms per character.
 */
export function animateReveal(container: HTMLElement, text: string): Promise<void> {
  container.textContent = '';
  if (prefersReducedMotion()) {
    container.textContent = text;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        container.textContent += text[i];
        i++;
        setTimeout(tick, 40);
      } else {
        resolve();
      }
    };
    tick();
  });
}

/**
 * Delay helper. Collapses to a near-instant tick when the user prefers reduced
 * motion, so motion-sensitive users get the full result without the long
 * step-by-step pacing while the phase sequencing still runs in order.
 */
export function delay(ms: number): Promise<void> {
  const effective = prefersReducedMotion() ? Math.min(ms, 10) : ms;
  return new Promise(resolve => setTimeout(resolve, effective));
}
