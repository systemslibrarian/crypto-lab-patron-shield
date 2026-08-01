/**
 * patron-shield — PIR protocol unit tests
 *
 * These are the "prove your own crypto" tests for the 2-server IT-PIR engine
 * (Chor–Goldreich–Kushilevitz–Sudan, 1995). They assert the two claims the demo
 * makes and would catch regressions in each:
 *
 *   1. CORRECTNESS — r1 ⊕ r2 reconstructs db[i] for EVERY index and for BOTH
 *      the "target bit set" and "target bit clear" cases of the random mask.
 *   2. PRIVACY-BY-CONSTRUCTION — the two masks differ in exactly one bit, that
 *      bit is the target index, and the collusion attack recovers exactly that
 *      index (the whole point of the non-collusion assumption).
 *
 * plus the plumbing (xorBytes, runServer as a linear XOR oracle, encoding) and
 * the edge cases the range/validity checks guard.
 */

import { describe, it, expect } from 'vitest';
import {
  xorBytes,
  generateQuery,
  runServer,
  reconstruct,
  runFullPIR,
  getSetBits,
  recoverByCollusion,
  lowBitsMask,
} from './pir.ts';
import { CATALOG, DB_SIZE, DATABASE, encodeBook } from './catalog.ts';

// popcount for a small non-negative integer
function popcount(x: number): number {
  let c = 0;
  for (let i = 0; i < 32; i++) c += (x >>> i) & 1;
  return c;
}

describe('xorBytes', () => {
  it('XORs byte-by-byte', () => {
    const a = new Uint8Array([0x00, 0xff, 0xaa, 0x0f]);
    const b = new Uint8Array([0xff, 0xff, 0x55, 0xf0]);
    expect(Array.from(xorBytes(a, b))).toEqual([0xff, 0x00, 0xff, 0xff]);
  });

  it('is self-inverse: a ⊕ b ⊕ b === a', () => {
    const a = new Uint8Array([1, 2, 3, 250, 17]);
    const b = new Uint8Array([9, 8, 7, 6, 5]);
    expect(Array.from(xorBytes(xorBytes(a, b), b))).toEqual(Array.from(a));
  });

  it('x ⊕ x === 0', () => {
    const a = new Uint8Array([1, 200, 3, 4]);
    expect(Array.from(xorBytes(a, a))).toEqual([0, 0, 0, 0]);
  });

  it('throws on length mismatch', () => {
    expect(() => xorBytes(new Uint8Array(3), new Uint8Array(4))).toThrow(/length mismatch/);
  });
});

describe('encodeBook (fixed 64-byte record)', () => {
  it('produces exactly 64 bytes with the title in [0,48) and author in [48,64)', () => {
    const rec = encodeBook(CATALOG[0]);
    expect(rec.length).toBe(64);
    // Title round-trips out of the first 48 bytes.
    const title = new TextDecoder().decode(rec.slice(0, 48)).replace(/\0+$/, '');
    expect(title).toBe(CATALOG[0].title);
    // Author bytes live in the tail region.
    const author = new TextDecoder().decode(rec.slice(48, 64)).replace(/\0+$/, '');
    expect(CATALOG[0].author.startsWith(author)).toBe(true);
  });

  it('every catalog record is 64 bytes', () => {
    for (const rec of DATABASE) expect(rec.length).toBe(64);
  });
});

describe('runServer (linear XOR oracle)', () => {
  it('mask 0 returns all-zero response', () => {
    const r = runServer(DATABASE, 0);
    expect(Array.from(r)).toEqual(new Array(64).fill(0));
  });

  it('single-bit mask returns exactly that record', () => {
    for (let i = 0; i < DB_SIZE; i++) {
      const r = runServer(DATABASE, 1 << i);
      expect(Array.from(r)).toEqual(Array.from(DATABASE[i]));
    }
  });

  it('is XOR-linear: server(m1) ⊕ server(m2) === server(m1 ⊕ m2) for disjoint masks', () => {
    const m1 = 0b0011; // records 0,1
    const m2 = 0b1100; // records 2,3
    const combined = xorBytes(runServer(DATABASE, m1), runServer(DATABASE, m2));
    expect(Array.from(combined)).toEqual(Array.from(runServer(DATABASE, m1 ^ m2)));
  });
});

describe('generateQuery (privacy-by-construction)', () => {
  it('masks differ in exactly one bit, and that bit is the target index', () => {
    for (let i = 0; i < DB_SIZE; i++) {
      const q = generateQuery(i);
      const diff = q.maskS ^ q.maskSPrime;
      expect(popcount(diff)).toBe(1);
      expect(diff).toBe(1 << i);
      expect(q.differingBit).toBe(i);
      expect(q.targetIndex).toBe(i);
    }
  });

  it('maskS stays within DB_SIZE bits', () => {
    const upper = (1 << DB_SIZE) - 1;
    for (let trial = 0; trial < 200; trial++) {
      const q = generateQuery(trial % DB_SIZE);
      expect(q.maskS & ~upper).toBe(0);
    }
  });

  it('rejects out-of-range indices', () => {
    expect(() => generateQuery(-1)).toThrow(/out of range/);
    expect(() => generateQuery(DB_SIZE)).toThrow(/out of range/);
  });

  it('produces a fresh random mask across runs (not a constant)', () => {
    const masks = new Set<number>();
    for (let k = 0; k < 64; k++) masks.add(generateQuery(0).maskS);
    // With a real CSPRNG over up to 2^DB_SIZE values, 64 draws should not all
    // collapse to a single value. This catches a mask stuck at a constant.
    expect(masks.size).toBeGreaterThan(1);
  });
});

describe('lowBitsMask (32-bit packing boundary)', () => {
  it('keeps all 32 bits instead of wrapping the shift count to zero', () => {
    expect(lowBitsMask(0)).toBe(0);
    expect(lowBitsMask(8)).toBe(0xff);
    expect(lowBitsMask(31)).toBe(0x7fffffff);
    expect(lowBitsMask(32)).toBe(0xffffffff);
  });

  it('rejects sizes that cannot fit the packed query representation', () => {
    expect(() => lowBitsMask(33)).toThrow(/out of range/);
  });
});

describe('reconstruct + full protocol correctness (KAT over the catalog)', () => {
  it('r1 ⊕ r2 reconstructs the exact title for every index', () => {
    for (let i = 0; i < DB_SIZE; i++) {
      const q = generateQuery(i);
      const r1 = runServer(DATABASE, q.maskS);
      const r2 = runServer(DATABASE, q.maskSPrime);
      expect(reconstruct(r1, r2)).toBe(CATALOG[i].title);
    }
  });

  it('is correct in BOTH mask cases: target bit set (Case A) and clear (Case B)', () => {
    const i = 3; // "The Name of the Wind"
    // Case A: force target bit SET in S.
    {
      const maskS = 0xff | (1 << i); // bit i set
      const maskSPrime = maskS ^ (1 << i);
      const out = reconstruct(runServer(DATABASE, maskS), runServer(DATABASE, maskSPrime));
      expect(out).toBe(CATALOG[i].title);
    }
    // Case B: force target bit CLEAR in S.
    {
      const maskS = 0x00; // bit i clear
      const maskSPrime = maskS ^ (1 << i);
      const out = reconstruct(runServer(DATABASE, maskS), runServer(DATABASE, maskSPrime));
      expect(out).toBe(CATALOG[i].title);
    }
  });

  it('runFullPIR reports isCorrect=true for every index across many random masks', () => {
    for (let trial = 0; trial < 500; trial++) {
      const i = trial % DB_SIZE;
      const res = runFullPIR(DATABASE, i);
      expect(res.isCorrect).toBe(true);
      expect(res.reconstructed).toBe(CATALOG[i].title);
    }
  });
});

describe('getSetBits', () => {
  it('lists the set bit positions within DB_SIZE', () => {
    expect(getSetBits(0)).toEqual([]);
    expect(getSetBits(0b101)).toEqual([0, 2]);
    expect(getSetBits((1 << DB_SIZE) - 1)).toEqual(
      Array.from({ length: DB_SIZE }, (_, k) => k),
    );
  });
});

describe('recoverByCollusion (the attack the non-collusion assumption prevents)', () => {
  it('recovers exactly the queried index from both masks', () => {
    for (let i = 0; i < DB_SIZE; i++) {
      const q = generateQuery(i);
      expect(recoverByCollusion(q.maskS, q.maskSPrime)).toBe(i);
    }
  });

  it('recovers the index regardless of the random mask value (100 trials/index)', () => {
    for (let i = 0; i < DB_SIZE; i++) {
      for (let t = 0; t < 100; t++) {
        const q = generateQuery(i);
        expect(recoverByCollusion(q.maskS, q.maskSPrime)).toBe(i);
      }
    }
  });

  it('returns -1 for identical masks (no differing bit)', () => {
    expect(recoverByCollusion(0b1011, 0b1011)).toBe(-1);
  });

  it('returns -1 when masks differ in more than one bit (not a valid query pair)', () => {
    expect(recoverByCollusion(0b0000, 0b0011)).toBe(-1);
    expect(recoverByCollusion(0b1010, 0b0101)).toBe(-1);
  });
});

describe('DB_SIZE / catalog invariants', () => {
  it('DB_SIZE matches the catalog length and fits the 32-bit mask cap', () => {
    expect(DB_SIZE).toBe(CATALOG.length);
    expect(DB_SIZE).toBeLessThanOrEqual(32);
  });
});
