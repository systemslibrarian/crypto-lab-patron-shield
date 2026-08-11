export interface Book {
  id: number;
  title: string;
  author: string;
  year: number;
  genre: string;
}

export interface PIRQuery {
  targetIndex: number;
  maskS: number;      // N-bit integer — Server 1's query
  maskSPrime: number; // N-bit integer — Server 2's query
  differingBit: number; // which bit position differs (= targetIndex)
}

export interface PIRResult {
  query: PIRQuery;
  response1: Uint8Array;     // Server 1's XOR response
  response2: Uint8Array;     // Server 2's XOR response
  record: Uint8Array;        // r1 XOR r2 — every byte the client recovered
  expectedRecord: Uint8Array; // db[targetIndex] from the database that was supplied
  reconstructed: string;     // title field of `record`, decoded
  isCorrect: boolean;        // record === db[targetIndex], byte for byte (all 64)
}

export interface ProtocolStep {
  phase: 'idle' | 'selecting' | 'generating' | 'server1' | 'server2' | 'reconstruct' | 'done';
  label: string;
  detail: string;
}
