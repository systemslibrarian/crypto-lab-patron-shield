/**
 * patron-shield — Private Information Retrieval demo
 * Protocol: 2-server IT-PIR (Chor et al., 1995)
 * "It is the glory of God to conceal a matter..." — Proverbs 25:2
 */

import type { Book } from './types.ts';

export const CATALOG: Book[] = [
  { id: 0, title: "The Midnight Library",     author: "Matt Haig",        year: 2020, genre: "Fiction"   },
  { id: 1, title: "Educated",                 author: "Tara Westover",    year: 2018, genre: "Memoir"    },
  { id: 2, title: "Atomic Habits",            author: "James Clear",      year: 2018, genre: "Self-Help" },
  { id: 3, title: "The Name of the Wind",     author: "Patrick Rothfuss", year: 2007, genre: "Fantasy"   },
  { id: 4, title: "Sapiens",                  author: "Yuval Noah Harari",year: 2011, genre: "History"   },
  { id: 5, title: "Where the Crawdads Sing",  author: "Delia Owens",      year: 2018, genre: "Mystery"   },
  { id: 6, title: "Project Hail Mary",        author: "Andy Weir",        year: 2021, genre: "Sci-Fi"    },
  { id: 7, title: "The Remains of the Day",   author: "Kazuo Ishiguro",   year: 1989, genre: "Literary"  },
];

/** Number of items in the database — masks are this many bits wide. */
export const DB_SIZE = CATALOG.length;

const encoder = new TextEncoder();

/**
 * Encode a Book into a fixed 64-byte Uint8Array:
 *   Bytes  0–47: UTF-8 title, zero-padded to 48 bytes (truncated if longer)
 *   Bytes 48–63: UTF-8 author last name, zero-padded to 16 bytes (truncated if longer)
 */
export function encodeBook(book: Book): Uint8Array {
  const buf = new Uint8Array(64); // initialized to zeros

  const titleBytes = encoder.encode(book.title);
  const titleSlice = titleBytes.slice(0, 48);
  buf.set(titleSlice, 0);

  const authorBytes = encoder.encode(book.author);
  const authorSlice = authorBytes.slice(0, 16);
  buf.set(authorSlice, 48);

  return buf;
}

/**
 * Encode all 32 books into their 64-byte representations.
 * Called once at module load.
 */
export function encodeDatabase(): Uint8Array[] {
  return CATALOG.map(encodeBook);
}

export const DATABASE: Uint8Array[] = encodeDatabase();

// Runtime assertion: all entries must be exactly 64 bytes
if (DATABASE.some(b => b.length !== 64)) {
  throw new Error('DATABASE integrity check failed: not all entries are 64 bytes');
}
if (DATABASE.length !== DB_SIZE) {
  throw new Error(`DATABASE integrity check failed: expected ${DB_SIZE} entries, got ${DATABASE.length}`);
}
