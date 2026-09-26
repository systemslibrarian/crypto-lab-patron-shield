/**
 * Independent reference check for the elementary two-replica XOR construction.
 * Chor, Goldreich, Kushilevitz, Sudan, "Private Information Retrieval" (1995):
 * https://people.csail.mit.edu/madhu/papers/1995/pir-conf.pdf
 *
 * This is an algebraic checker, not a published known-answer vector or a second
 * implementation of the paper's more communication-efficient schemes. It does
 * not import the lab's query, server, XOR, reconstruction, or decoder helpers.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, DATABASE } from '../catalog.ts';
import { runFullPIR, runServer } from '../pir.ts';

// For byte k, response(S)[k] = sum over GF(2) of S[j] * DB[j][k].
// BigInt selection and per-bit parity keep the oracle separate from the
// production Uint32 mask loop and byte-wise XOR accumulator.
function referenceResponse(records: Uint8Array[], mask: bigint): number[] {
  return Array.from({ length: records[0].length }, (_, byte) => {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) {
      let parity = 0;
      records.forEach((record, index) => {
        parity += Number((mask >> BigInt(index)) & 1n) * ((record[byte] >> bit) & 1);
      });
      value += (parity % 2) * 2 ** bit;
    }
    return value;
  });
}

describe('independent two-server XOR reference', () => {
  it('checks each server against GF(2) sums for every eight-record mask', () => {
    for (let mask = 0; mask < 2 ** DATABASE.length; mask++) {
      expect(Array.from(runServer(DATABASE, mask))).toEqual(
        referenceResponse(DATABASE, BigInt(mask)),
      );
    }
  });

  it('checks both responses and the selected book for every catalog choice', () => {
    for (let index = 0; index < CATALOG.length; index++) {
      const result = runFullPIR(DATABASE, index);
      const first = BigInt(result.query.maskS);
      const second = BigInt(result.query.maskSPrime);
      expect(first ^ second).toBe(1n << BigInt(index));

      const expectedFirst = referenceResponse(DATABASE, first);
      const expectedSecond = referenceResponse(DATABASE, second);
      expect(Array.from(result.response1)).toEqual(expectedFirst);
      expect(Array.from(result.response2)).toEqual(expectedSecond);

      const combined = expectedFirst.map((byte, k) => byte ^ expectedSecond[k]);
      expect(combined).toEqual(Array.from(DATABASE[index]));
      expect(Array.from(result.record)).toEqual(combined);
      expect(result.reconstructed).toBe(CATALOG[index].title);
    }
  });
});
