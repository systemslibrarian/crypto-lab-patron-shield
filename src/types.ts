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
  response1: Uint8Array; // Server 1's XOR response
  response2: Uint8Array; // Server 2's XOR response
  reconstructed: string; // decoded book title
  isCorrect: boolean;    // reconstructed === catalog[targetIndex].title
}

export interface ProtocolStep {
  phase: 'idle' | 'selecting' | 'generating' | 'server1' | 'server2' | 'reconstruct' | 'done';
  label: string;
  detail: string;
}
