/**
 * patron-shield — Bitmask Visualizer
 * Renders 32-bit masks as animated bit-square grids and XOR chains.
 */

import type { Book } from './types.ts';

/**
 * Render a 32-bit mask as a 4×8 grid of bit squares.
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

  for (let i = 0; i < numBits; i++) {
    const bit = (mask >>> i) & 1;
    const sq = document.createElement('div');
    sq.className = `bit-square bit-${bit}`;
    sq.dataset.index = String(i);

    if (bit === 1) {
      sq.style.background = color;
    }

    if (animateIn) {
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
 * Reveal text character-by-character, 40ms per character.
 */
export function animateReveal(container: HTMLElement, text: string): Promise<void> {
  container.textContent = '';
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
 * Simple delay helper.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
