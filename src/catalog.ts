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
 * Truncate a string to at most `maxBytes` of UTF-8 WITHOUT splitting a
 * character. Slicing the encoded bytes at a fixed offset can cut a multi-byte
 * code point in half, and the trailing fragment decodes to U+FFFD — so the page
 * would claim it "rebuilt the exact book" while displaying a replacement
 * character. Every current catalog entry is ASCII, so this was dormant; the
 * invariant that permitted it was that encodeBook accepted arbitrary strings.
 *
 * `encodeInto` reports how many whole code points fit, which is exactly the
 * boundary-safe cut.
 */
export function encodeUtf8Truncated(text: string, maxBytes: number): Uint8Array {
  const buf = new Uint8Array(maxBytes);
  const { written } = encoder.encodeInto(text, buf);
  return buf.subarray(0, written);
}

/**
 * Encode a Book into a fixed 64-byte Uint8Array:
 *   Bytes  0–47: UTF-8 title, zero-padded to 48 bytes (truncated if longer)
 *   Bytes 48–63: UTF-8 author name as written, zero-padded to 16 bytes and
 *                truncated if longer ("Yuval Noah Harari" stores as "Yuval Noah Harar")
 *
 * Truncation of either field happens at a code-point boundary, never mid-character.
 */
export function encodeBook(book: Book): Uint8Array {
  const buf = new Uint8Array(64); // initialized to zeros

  buf.set(encodeUtf8Truncated(book.title, 48), 0);
  buf.set(encodeUtf8Truncated(book.author, 16), 48);

  return buf;
}

/**
 * Encode all books into their 64-byte representations.
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
