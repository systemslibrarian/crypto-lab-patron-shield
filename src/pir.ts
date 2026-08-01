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
 *   single-server private retrieval for a weaker, but practical, trust assumption:
 *   at least one of the two servers is honest.
 * -----------------------------------------------------------------------
 */

import type { PIRQuery, PIRResult } from './types.ts';
import { CATALOG, DB_SIZE } from './catalog.ts';

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
 * Generate a PIR query pair for the given target index (0 to DB_SIZE-1).
 * Uses crypto.getRandomValues for cryptographically random S.
 *
 * Returns:
 *   maskS      — Server 1's query: a uniform random N-bit integer (N = DB_SIZE)
 *   maskSPrime — Server 2's query: maskS with bit targetIndex flipped
 *   differingBit — always equals targetIndex
 */
export function generateQuery(targetIndex: number): PIRQuery {
  if (targetIndex < 0 || targetIndex >= DB_SIZE) {
    throw new Error(`generateQuery: targetIndex ${targetIndex} out of range [0,${DB_SIZE - 1}]`);
  }

  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  // Mask to DB_SIZE bits so only valid bit positions are used. JavaScript
  // shifts wrap at 32, so `(1 << 32) - 1` is zero rather than 0xffffffff.
  const maskS = (rand[0] & lowBitsMask(DB_SIZE)) >>> 0;

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
 * Simulate a single PIR server response.
 * For each bit position j (0 to DB_SIZE-1), if that bit is set in `mask`,
 * XOR db[j] into the accumulator.
 *
 * Used for both Server 1 (pass maskS) and Server 2 (pass maskSPrime).
 */
export function runServer(db: Uint8Array[], mask: number): Uint8Array {
  const result = new Uint8Array(64); // initialized to zeros
  for (let j = 0; j < DB_SIZE; j++) {
    if ((mask >>> j) & 1) {
      for (let k = 0; k < 64; k++) {
        result[k] ^= db[j][k];
      }
    }
  }
  return result;
}

/**
 * Reconstruct the book title from two server responses.
 * XORs the two responses, then decodes bytes 0–47 as UTF-8, trimming null bytes.
 */
export function reconstruct(r1: Uint8Array, r2: Uint8Array): string {
  const combined = xorBytes(r1, r2);
  // Extract title bytes (0–47) and trim null padding
  const titleBytes = combined.slice(0, 48);
  let end = titleBytes.length;
  while (end > 0 && titleBytes[end - 1] === 0) end--;
  return decoder.decode(titleBytes.slice(0, end));
}

/**
 * Run the complete PIR protocol for a single query.
 * Returns full result including both server responses and correctness check.
 */
export function runFullPIR(db: Uint8Array[], targetIndex: number): PIRResult {
  const query = generateQuery(targetIndex);
  const response1 = runServer(db, query.maskS);
  const response2 = runServer(db, query.maskSPrime);
  const reconstructed = reconstruct(response1, response2);
  const isCorrect = reconstructed === CATALOG[targetIndex].title;

  return {
    query,
    response1,
    response2,
    reconstructed,
    isCorrect,
  };
}

/**
 * Return an array of bit indices that are set in a mask.
 */
export function getSetBits(mask: number): number[] {
  const bits: number[] = [];
  for (let j = 0; j < DB_SIZE; j++) {
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
 */
export function recoverByCollusion(maskS: number, maskSPrime: number): number {
  const diff = maskS ^ maskSPrime;
  // A valid query pair differs in exactly one bit — diff must be a power of two.
  if (diff === 0 || (diff & (diff - 1)) !== 0) return -1;
  return Math.log2(diff);
}
