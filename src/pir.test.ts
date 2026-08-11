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
  reconstructRecord,
  decodeTitle,
  decodeAuthor,
  bytesEqual,
  recordsMatch,
  databaseShape,
  runFullPIR,
  getSetBits,
  recoverByCollusion,
  lowBitsMask,
} from './pir.ts';
import { CATALOG, DB_SIZE, DATABASE, encodeBook, encodeUtf8Truncated } from './catalog.ts';

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

  // The invariant above is what made the bit-31 NaN latent rather than harmless:
  // it permitted exactly the range that broke. Every size it permits must work,
  // so the suite below runs the whole protocol at DB_SIZE = 32.
  it('every database size this invariant permits is actually exercised', () => {
    const permittedMax = 32;
    const covered = syntheticDb(permittedMax);
    expect(databaseShape(covered).size).toBe(permittedMax);
    // 33 records cannot be packed into a 32-bit mask, so the cap is a real cap.
    expect(() => databaseShape(syntheticDb(33))).toThrow(/exceeds the 32-bit packed mask/);
  });
});

// ============================================================
// Regression: the 32-record boundary (bit 31)
// ============================================================

/** A synthetic database of `size` distinct 64-byte records. */
function syntheticDb(size: number): Uint8Array[] {
  return Array.from({ length: size }, (_, i) => {
    const rec = new Uint8Array(64);
    // Distinct in every byte position, so a wrong record cannot alias a right one.
    for (let k = 0; k < 64; k++) rec[k] = (i * 31 + k * 7 + 1) & 0xff;
    return rec;
  });
}

describe('bit 31 — the index the 32-bit mask cap permits and Math.log2 broke', () => {
  it('recovers index 31 from a mask pair whose XOR sets the sign bit', () => {
    // maskS ^ maskSPrime === -2147483648 as a SIGNED int32. The power-of-two
    // guard passes on it, and Math.log2 of a negative is NaN — so the collusion
    // panel used to print bit [NaN] and title "(unknown)" for this one index.
    expect(recoverByCollusion(0x00000000, 0x80000000)).toBe(31);
    expect((0x00000000 ^ 0x80000000) < 0).toBe(true); // the trap is still there…
    expect(0x80000000 & (0x80000000 - 1)).toBe(0);    // …and still passes the guard
  });

  it('recovers EVERY index 0..31 across random masks, with none returning NaN', () => {
    let signBitPairs = 0;
    for (let i = 0; i < 32; i++) {
      for (let t = 0; t < 50; t++) {
        const q = generateQuery(i, 32);
        const got = recoverByCollusion(q.maskS, q.maskSPrime);
        expect(Number.isNaN(got), `index ${i}: recovery returned NaN`).toBe(false);
        expect(got, `index ${i}, trial ${t}`).toBe(i);
        if (((q.maskS ^ q.maskSPrime) >>> 0) === 0x80000000) signBitPairs++;
      }
    }
    // Fail if the loop never reached the state it exists to cover.
    expect(signBitPairs, 'no trial produced a bit-31 mask pair — this test proved nothing')
      .toBe(50);
  });

  it('runs the whole protocol correctly on a 32-record database, index 31 included', () => {
    const db = syntheticDb(32);
    let bit31Runs = 0;
    for (let i = 0; i < 32; i++) {
      const res = runFullPIR(db, i);
      expect(res.isCorrect, `index ${i} did not reconstruct`).toBe(true);
      expect(bytesEqual(res.record, db[i]), `index ${i} bytes`).toBe(true);
      expect(recoverByCollusion(res.query.maskS, res.query.maskSPrime)).toBe(i);
      if (i === 31) bit31Runs++;
    }
    expect(bit31Runs, 'index 31 was never run').toBe(1);
  });

  it('masks stay inside the database width at DB size 32 (the shift does not wrap)', () => {
    for (let t = 0; t < 200; t++) {
      const q = generateQuery(t % 32, 32);
      expect(q.maskS).toBeGreaterThanOrEqual(0);
      expect(q.maskS).toBeLessThanOrEqual(0xffffffff);
      expect(q.maskSPrime).toBeGreaterThanOrEqual(0);
      expect(((q.maskS ^ q.maskSPrime) >>> 0)).toBe((1 << (t % 32)) >>> 0);
    }
  });
});

// ============================================================
// Regression: index validation
// ============================================================

describe('generateQuery rejects indices that are not integers', () => {
  it('rejects NaN — which used to pass the range check and silently target bit 0', () => {
    // NaN < 0 is false and NaN >= DB_SIZE is false, so a comparison-only guard
    // let it through; `1 << NaN` is 1, producing a valid-looking query for
    // record 0 while differingBit reported NaN.
    expect(() => generateQuery(NaN)).toThrow(/must be an integer/);
  });

  it('rejects fractional indices — 1.5 used to target bit 1', () => {
    expect(() => generateQuery(1.5)).toThrow(/must be an integer/);
    expect(() => generateQuery(0.5)).toThrow(/must be an integer/);
  });

  it('rejects numeric strings coerced in from an unsafe caller', () => {
    expect(() => generateQuery('3' as unknown as number)).toThrow(/must be an integer/);
  });

  it('still rejects Infinity and negative fractions by range or integrality', () => {
    expect(() => generateQuery(Infinity)).toThrow();
    expect(() => generateQuery(-0.5)).toThrow();
    expect(() => generateQuery(-1)).toThrow(/out of range/);
    expect(() => generateQuery(DB_SIZE)).toThrow(/out of range/);
  });

  it('every index it ACCEPTS keeps differingBit === targetIndex', () => {
    let accepted = 0;
    for (let i = 0; i < DB_SIZE; i++) {
      const q = generateQuery(i);
      expect(q.differingBit).toBe(q.targetIndex);
      expect(Number.isInteger(q.differingBit)).toBe(true);
      expect(recoverByCollusion(q.maskS, q.maskSPrime)).toBe(q.targetIndex);
      accepted++;
    }
    expect(accepted).toBe(DB_SIZE);
  });
});

// ============================================================
// Regression: correctness is about the SUPPLIED database, all of it
// ============================================================

describe('runFullPIR checks the supplied database, byte for byte', () => {
  it('reports isCorrect on a database that is not the demo catalog', () => {
    const db = syntheticDb(8);
    let runs = 0;
    for (let i = 0; i < 8; i++) {
      const res = runFullPIR(db, i);
      // Comparing the decoded title against CATALOG[i].title made this false for
      // every index: a generic protocol function silently read a global.
      expect(res.isCorrect, `synthetic db index ${i}`).toBe(true);
      expect(res.expectedRecord).toEqual(db[i]);
      runs++;
    }
    expect(runs).toBe(8);
  });

  // The reconstruction verdict is the claim "r1 ⊕ r₂ rebuilt … the stored record".
  // With two honest servers r1 ⊕ r2 is ALWAYS exact, so no normal run can reach
  // the false branch — the verdict predicate has to be tested directly, against a
  // record corrupted the way a malicious server would corrupt it.
  it('recordsMatch rejects a record whose AUTHOR bytes were altered', () => {
    const target = 4; // "Sapiens" / "Yuval Noah Harar"
    const stored = DATABASE[target];

    // Simulate one server flipping a single byte of its response: r1 ⊕ r2 then
    // differs from the stored record in exactly that byte.
    const q = generateQuery(target);
    const r1 = runServer(DATABASE, q.maskS);
    const r2 = Uint8Array.from(runServer(DATABASE, q.maskSPrime));
    r2[50] ^= 0xff; // byte 50 is inside the author field [48,64)
    const corrupted = reconstructRecord(r1, r2);

    // Exactly one byte is wrong, and it is an author byte — the title is untouched.
    const wrong = [...corrupted].filter((b, k) => b !== stored[k]);
    expect(wrong.length, 'the fault must land on exactly one byte').toBe(1);
    expect(decodeTitle(corrupted), 'the title must be unchanged').toBe(CATALOG[target].title);
    expect(decodeAuthor(corrupted)).not.toBe(decodeAuthor(stored));

    // A title-only verdict — what the code used to compute — calls this correct.
    expect(
      decodeTitle(corrupted) === decodeTitle(stored),
      'the counterexample must be one a title-only check accepts',
    ).toBe(true);
    // The shipped verdict must not.
    expect(recordsMatch(corrupted, stored), 'the verdict must cover all 64 bytes').toBe(false);
  });

  it('recordsMatch accepts an honest run and covers the whole record length', () => {
    let checked = 0;
    for (let i = 0; i < DB_SIZE; i++) {
      const res = runFullPIR(DATABASE, i);
      expect(recordsMatch(res.record, res.expectedRecord)).toBe(true);
      expect(res.record.length).toBe(64);
      // Every byte position must be able to break the verdict — no unchecked tail.
      for (const k of [0, 20, 47, 48, 55, 63]) {
        const nudged = Uint8Array.from(res.record);
        nudged[k] ^= 0x01;
        expect(recordsMatch(nudged, res.expectedRecord), `byte ${k} is unchecked`).toBe(false);
      }
      checked++;
    }
    expect(checked).toBe(DB_SIZE);
  });

  it('reconstructRecord returns all 64 bytes, not just the title field', () => {
    const q = generateQuery(2);
    const rec = reconstructRecord(runServer(DATABASE, q.maskS), runServer(DATABASE, q.maskSPrime));
    expect(rec.length).toBe(64);
    expect(bytesEqual(rec, DATABASE[2])).toBe(true);
    expect(reconstruct(runServer(DATABASE, q.maskS), runServer(DATABASE, q.maskSPrime)))
      .toBe(CATALOG[2].title);
  });
});

// ============================================================
// Regression: database shape validation
// ============================================================

describe('runServer validates the database it was handed', () => {
  it('rejects records of unequal length', () => {
    const db = [new Uint8Array(64), new Uint8Array(32)];
    expect(() => runServer(db, 0b11)).toThrow(/same length/);
  });

  it('rejects an empty database', () => {
    expect(() => runServer([], 0)).toThrow(/non-empty/);
  });

  it('rejects mask bits that name records outside the database', () => {
    expect(() => runServer(DATABASE, 1 << DB_SIZE)).toThrow(/outside the 8-record database/);
  });

  it('returns a response the length of the records, not a hardcoded 64', () => {
    const db = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    const r = runServer(db, 0b01);
    expect(r.length).toBe(3);
    expect(Array.from(r)).toEqual([1, 2, 3]);
    expect(Array.from(runServer(db, 0b11))).toEqual([1 ^ 4, 2 ^ 5, 3 ^ 6]);
  });
});

// ============================================================
// Regression: UTF-8 truncation cannot split a character
// ============================================================

describe('encodeBook truncates at code-point boundaries', () => {
  const decode = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(b);

  it('never produces a replacement character, at any cut point', () => {
    // Sweep the cut through a run of 3-byte CJK and 4-byte emoji so the boundary
    // lands inside a character at most positions. A byte-slice fails these.
    const samples = ['日本語のタイトルです。これは長い題名', '🔐🔑🛡️🗝️🧩🧿🔒🔓🗄️📚📖📕📗📘📙📔'];
    let midCharCuts = 0;
    for (const s of samples) {
      const full = new TextEncoder().encode(s);
      for (let max = 1; max <= full.length; max++) {
        const out = encodeUtf8Truncated(s, max);
        expect(out.length).toBeLessThanOrEqual(max);
        expect(decode(out), `cut at ${max} of "${s}"`).not.toContain('�');
        // Round-trips to a prefix of the original string.
        expect(s.startsWith(decode(out))).toBe(true);
        if (out.length < max) midCharCuts++;
      }
    }
    // If no cut ever landed mid-character the sweep proved nothing.
    expect(midCharCuts, 'no cut point landed inside a character — test is vacuous')
      .toBeGreaterThan(0);
  });

  it('encodes a book with multibyte title and author into a valid 64-byte record', () => {
    const rec = encodeBook({
      id: 0,
      title: '記憶の図書館 — 真夜中を過ぎて、静かな棚のあいだで',
      author: '村上春樹といくらか',
      year: 2020,
      genre: 'Fiction',
    });
    expect(rec.length).toBe(64);
    expect(decodeTitle(rec)).not.toContain('�');
    expect(decodeAuthor(rec)).not.toContain('�');
    // Both fields must actually have been truncated, or this proves nothing.
    expect(new TextEncoder().encode('記憶の図書館 — 真夜中を過ぎて、静かな棚のあいだで').length)
      .toBeGreaterThan(48);
    expect(new TextEncoder().encode('村上春樹といくらか').length).toBeGreaterThan(16);
  });

  it('leaves every ASCII catalog record byte-identical to a plain slice', () => {
    for (const book of CATALOG) {
      const enc = new TextEncoder();
      const expected = new Uint8Array(64);
      expected.set(enc.encode(book.title).slice(0, 48), 0);
      expected.set(enc.encode(book.author).slice(0, 16), 48);
      expect(bytesEqual(encodeBook(book), expected), book.title).toBe(true);
    }
  });
});
