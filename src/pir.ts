/**
 * patron-shield — PIR Protocol Engine
 * Implements 2-server Information-Theoretic Private Information Retrieval
 * Chor, Goldreich, Kushilevitz, Sudan (1995)
 *
 * -----------------------------------------------------------------------
 * CORRECTNESS PROOF
 * -----------------------------------------------------------------------
 * Let S be a uniform random N-bit mask (N = DB_SIZE). Define S' = S XOR (1 << i),
 * flipping exactly bit i. The client sends S to Server 1 and S' to Server 2.
 *
 * Case A — bit i is SET in S:  S' = S \ {i}  (S' has bit i cleared)
 *   r1 = XOR of db[j] for all j where bit j of S  is 1
 *      = db[i] ⊕ (XOR of db[j] for j in S \ {i})
 *   r2 = XOR of db[j] for all j where bit j of S' is 1
 *      = XOR of db[j] for j in S \ {i}
 *   r1 ⊕ r2 = db[i]  ✓
 *
 * Case B — bit i is NOT SET in S:  S' = S ∪ {i}  (S' has bit i set)
 *   r1 = XOR of db[j] for j in S
 *   r2 = XOR of db[j] for j in S ∪ {i}
 *      = db[i] ⊕ (XOR of db[j] for j in S)
 *   r1 ⊕ r2 = db[i]  ✓
 *
 * Privacy:
 *   Server 1 sees S  — a uniform random N-bit value. No information about i.
 *   Server 2 sees S' — S with one bit flipped. From Server 2's view, S' is
 *   also uniformly distributed over N-bit integers (XOR with any fixed value
 *   preserves the uniform distribution). Neither server alone can determine i.
 *   The privacy guarantee is INFORMATION-THEORETIC: it holds regardless of
 *   server computational power.
 *
 * TRUST ASSUMPTION — NON-COLLUSION (this is the whole catch):
 *   Privacy holds ONLY if the two servers do not pool their queries. The masks
 *   satisfy S ⊕ S' = (1 << i) by construction, so any party that sees BOTH masks
 *   recovers the target index i with a single XOR (see recoverByCollusion below).
 *   Two-server IT-PIR therefore trades the "download the whole database" cost of
 *   single-server private retrieval for a non-collusion assumption.
 *
 *   PRIVACY and CORRECTNESS rest on different assumptions, and it is a mistake to
 *   collapse both into "at least one server is honest":
 *     - INDEX PRIVACY survives as long as no single party obtains BOTH masks.
 *       One dishonest server learns nothing on its own, however it behaves.
 *     - CORRECTNESS requires BOTH servers to compute their response honestly.
 *       A single malicious server can return arbitrary bytes; r1 ⊕ r2 is then a
 *       corrupted record and this protocol has no way to detect it. Detecting
 *       that needs an added integrity mechanism (an authenticated database
 *       snapshot, commitments, or verifiable computation) that IT-PIR does not
 *       itself provide.
 * -----------------------------------------------------------------------
 */

import type { PIRQuery, PIRResult } from './types.ts';
import { DB_SIZE } from './catalog.ts';

const decoder = new TextDecoder('utf-8');

/**
 * XOR two equal-length Uint8Arrays byte-by-byte.
 * Returns a new Uint8Array of the same length.
 */
export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error(`xorBytes: length mismatch ${a.length} vs ${b.length}`);
  }
  const result = new Uint8Array(a.length);
  for (let k = 0; k < a.length; k++) {
    result[k] = a[k] ^ b[k];
  }
  return result;
}

/**
 * Generate a PIR query pair for the given target index (0 to dbSize-1).
 * Uses crypto.getRandomValues for a uniformly random S.
 *
 * `targetIndex` must be an INTEGER. A comparison-only range check is not enough:
 * `NaN < 0` and `NaN >= dbSize` are both false, so NaN used to pass the guard and
 * then be coerced to 0 by the shift operator — producing a structurally valid
 * query pair that targets record 0 while reporting `differingBit: NaN`. A
 * fractional index behaved the same way (1.5 targeted bit 1). Both broke the
 * documented invariant `differingBit === targetIndex` silently.
 *
 * Returns:
 *   maskS      — Server 1's query: a uniform random N-bit integer (N = dbSize)
 *   maskSPrime — Server 2's query: maskS with bit targetIndex flipped
 *   differingBit — always equals targetIndex
 */
export function generateQuery(targetIndex: number, dbSize: number = DB_SIZE): PIRQuery {
  if (!Number.isInteger(targetIndex)) {
    throw new Error(`generateQuery: targetIndex must be an integer, got ${targetIndex}`);
  }
  if (targetIndex < 0 || targetIndex >= dbSize) {
    throw new Error(`generateQuery: targetIndex ${targetIndex} out of range [0,${dbSize - 1}]`);
  }

  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  // Mask to dbSize bits so only valid bit positions are used. JavaScript
  // shifts wrap at 32, so `(1 << 32) - 1` is zero rather than 0xffffffff.
  const maskS = (rand[0] & lowBitsMask(dbSize)) >>> 0;

  // Flip exactly bit targetIndex to produce S'
  const maskSPrime = (maskS ^ (1 << targetIndex)) >>> 0;

  return {
    targetIndex,
    maskS,
    maskSPrime,
    differingBit: targetIndex,
  };
}

/** Return an unsigned mask with the lowest `bitCount` bits set. */
export function lowBitsMask(bitCount: number): number {
  if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 32) {
    throw new Error(`lowBitsMask: bitCount ${bitCount} out of range [0,32]`);
  }
  return bitCount === 32 ? 0xffffffff : (2 ** bitCount - 1) >>> 0;
}

/**
 * Validate that a database is a usable PIR database and return its shape.
 * Both servers must agree on record count and record length; a mismatch makes
 * r1 ⊕ r2 silently corrupt rather than obviously wrong.
 */
export function databaseShape(db: Uint8Array[]): { size: number; recordLength: number } {
  if (!Array.isArray(db) || db.length === 0) {
    throw new Error('PIR database must be a non-empty array of records');
  }
  if (db.length > 32) {
    throw new Error(`PIR database of ${db.length} records exceeds the 32-bit packed mask (max 32)`);
  }
  const recordLength = db[0].length;
  if (recordLength === 0) throw new Error('PIR records must be non-empty');
  for (let j = 0; j < db.length; j++) {
    if (db[j].length !== recordLength) {
      throw new Error(
        `PIR records must all be the same length: db[0] is ${recordLength}, db[${j}] is ${db[j].length}`,
      );
    }
  }
  return { size: db.length, recordLength };
}

/**
 * Simulate a single PIR server response.
 * For each bit position j (0 to db.length-1), if that bit is set in `mask`,
 * XOR db[j] into the accumulator.
 *
 * Used for both Server 1 (pass maskS) and Server 2 (pass maskSPrime).
 *
 * The record count and record length come from `db`, NOT from the module-global
 * DB_SIZE / a hardcoded 64. A server that read its width from a global while
 * being handed a database argument would silently ignore records past that width
 * — and made the 32-record boundary (see recoverByCollusion) untestable.
 */
export function runServer(db: Uint8Array[], mask: number): Uint8Array {
  const { size, recordLength } = databaseShape(db);
  // A mask bit outside the database range names a record that does not exist.
  if (((mask >>> 0) & ~lowBitsMask(size)) >>> 0) {
    throw new Error(
      `runServer: mask 0x${(mask >>> 0).toString(16)} sets bits outside the ${size}-record database`,
    );
  }
  const result = new Uint8Array(recordLength); // initialized to zeros
  for (let j = 0; j < size; j++) {
    if ((mask >>> j) & 1) {
      for (let k = 0; k < recordLength; k++) {
        result[k] ^= db[j][k];
      }
    }
  }
  return result;
}

/**
 * Reconstruct the full record bytes from two server responses: r1 ⊕ r2.
 * This is the whole protocol output — every byte the client recovers.
 */
export function reconstructRecord(r1: Uint8Array, r2: Uint8Array): Uint8Array {
  return xorBytes(r1, r2);
}

/** Decode the title field (bytes 0–47) of a 64-byte record, trimming null padding. */
export function decodeTitle(record: Uint8Array): string {
  return decodeField(record, 0, 48);
}

/** Decode the author field (bytes 48–63) of a 64-byte record, trimming null padding. */
export function decodeAuthor(record: Uint8Array): string {
  return decodeField(record, 48, 64);
}

function decodeField(record: Uint8Array, start: number, stop: number): string {
  const bytes = record.slice(start, Math.min(stop, record.length));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return decoder.decode(bytes.slice(0, end));
}

/**
 * Reconstruct the book title from two server responses.
 * XORs the two responses, then decodes bytes 0–47 as UTF-8, trimming null bytes.
 */
export function reconstruct(r1: Uint8Array, r2: Uint8Array): string {
  return decodeTitle(reconstructRecord(r1, r2));
}

/** Byte-for-byte equality. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * The reconstruction verdict the page prints as "rebuilt … the stored record".
 * It is EVERY byte, not the decoded title: the title occupies bytes 0–47 and the
 * author 48–63, so a title-only comparison declares a record with a corrupted
 * author "Correct" — while the badge claims the exact book was rebuilt.
 * Exported so the claim can be tested against a deliberately corrupted record;
 * with two honest servers r1 ⊕ r2 is always exact, so nothing inside a normal
 * run can ever exercise the false branch.
 */
export function recordsMatch(reconstructed: Uint8Array, expected: Uint8Array): boolean {
  return bytesEqual(reconstructed, expected);
}

/**
 * Run the complete PIR protocol for a single query.
 * Returns full result including both server responses and correctness check.
 *
 * `isCorrect` is a BYTE-FOR-BYTE comparison of the reconstructed record against
 * `db[targetIndex]` — the database that was actually supplied. Two things were
 * wrong with comparing the decoded title against the module-global
 * `CATALOG[targetIndex].title` instead:
 *   1. It made a "generic" protocol function silently depend on the demo's own
 *      catalog, so a caller passing a different database got isCorrect=false
 *      even when PIR had reconstructed that database's record perfectly.
 *   2. It only covered bytes 0–47. The badge says "rebuilt the exact book" while
 *      the 16 author bytes went unchecked — a corrupted author reconstructed as
 *      "Correct".
 */
export function runFullPIR(db: Uint8Array[], targetIndex: number): PIRResult {
  const { size } = databaseShape(db);
  const query = generateQuery(targetIndex, size);
  const response1 = runServer(db, query.maskS);
  const response2 = runServer(db, query.maskSPrime);
  const record = reconstructRecord(response1, response2);
  const expectedRecord = db[targetIndex];
  const isCorrect = recordsMatch(record, expectedRecord);

  return {
    query,
    response1,
    response2,
    record,
    expectedRecord,
    reconstructed: decodeTitle(record),
    isCorrect,
  };
}

/**
 * Return an array of bit indices that are set in a mask, over `width` bits.
 */
export function getSetBits(mask: number, width: number = DB_SIZE): number[] {
  const bits: number[] = [];
  for (let j = 0; j < width; j++) {
    if ((mask >>> j) & 1) bits.push(j);
  }
  return bits;
}

/**
 * The collusion attack: given BOTH server masks, recover the target index.
 * Because S' = S ⊕ (1 << i), we have S ⊕ S' = (1 << i), so a single XOR
 * exposes the one differing bit — and therefore exactly which book was queried.
 * This is precisely what the non-colluding-servers assumption prevents.
 *
 * Returns the recovered target index, or -1 if the masks differ in zero or
 * more than one bit (which a correct protocol run never produces).
 *
 * `Math.clz32` and the `>>> 0` are EACH independently sufficient here, and both
 * are applied. JavaScript's bitwise operators produce SIGNED 32-bit integers, so
 * with bit 31 set
 * `maskS ^ maskSPrime` is -2147483648. The power-of-two guard still passes
 * (-2147483648 & -2147483649 === 0), and `Math.log2` of a negative number is
 * NaN — so the attack panel used to report bit `[NaN]` and title "(unknown)" for
 * exactly one index out of 32, in the panel whose entire job is to show that
 * collusion recovers the index. Measured: 200/200 trials at bit 31 returned NaN,
 * 6200/6200 at bits 0–30 were correct.
 */
export function recoverByCollusion(maskS: number, maskSPrime: number): number {
  const diff = (maskS ^ maskSPrime) >>> 0;
  // A valid query pair differs in exactly one bit — diff must be a power of two.
  if (diff === 0 || (diff & (diff - 1)) !== 0) return -1;
  return 31 - Math.clz32(diff);
}
