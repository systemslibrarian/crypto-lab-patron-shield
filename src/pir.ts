/**
 * patron-shield — PIR Protocol Engine
 * Implements 2-server Information-Theoretic Private Information Retrieval
 * Chor, Goldreich, Kushilevitz, Sudan (1995)
 *
 * -----------------------------------------------------------------------
 * CORRECTNESS PROOF
 * -----------------------------------------------------------------------
 * Let S be a uniform random 32-bit mask. Define S' = S XOR (1 << i),
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
 *   Server 1 sees S  — a uniform random 32-bit value. No information about i.
 *   Server 2 sees S' — S with one bit flipped. From Server 2's view, S' is
 *   also uniformly distributed over 32-bit integers (XOR with any fixed value
 *   preserves the uniform distribution). Neither server alone can determine i.
 *   The privacy guarantee is INFORMATION-THEORETIC: it holds regardless of
 *   server computational power.
 * -----------------------------------------------------------------------
 */

import type { PIRQuery, PIRResult } from './types.ts';
import { CATALOG } from './catalog.ts';

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
 * Generate a PIR query pair for the given target index (0–31).
 * Uses crypto.getRandomValues for cryptographically random S.
 *
 * Returns:
 *   maskS      — Server 1's query: a uniform random 32-bit integer
 *   maskSPrime — Server 2's query: maskS with bit targetIndex flipped
 *   differingBit — always equals targetIndex
 */
export function generateQuery(targetIndex: number): PIRQuery {
  if (targetIndex < 0 || targetIndex > 31) {
    throw new Error(`generateQuery: targetIndex ${targetIndex} out of range [0,31]`);
  }

  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const maskS = rand[0]; // uniform random 32-bit unsigned integer

  // Flip exactly bit targetIndex to produce S'
  const maskSPrime = maskS ^ (1 << targetIndex);

  return {
    targetIndex,
    maskS,
    maskSPrime,
    differingBit: targetIndex,
  };
}

/**
 * Simulate a single PIR server response.
 * For each bit position j (0–31), if that bit is set in `mask`,
 * XOR db[j] into the accumulator.
 *
 * Used for both Server 1 (pass maskS) and Server 2 (pass maskSPrime).
 */
export function runServer(db: Uint8Array[], mask: number): Uint8Array {
  const result = new Uint8Array(64); // initialized to zeros
  for (let j = 0; j < 32; j++) {
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
 * Return an array of bit indices that are set in a 32-bit mask.
 */
export function getSetBits(mask: number): number[] {
  const bits: number[] = [];
  for (let j = 0; j < 32; j++) {
    if ((mask >>> j) & 1) bits.push(j);
  }
  return bits;
}
