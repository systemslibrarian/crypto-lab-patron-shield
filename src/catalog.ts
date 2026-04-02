/**
 * patron-shield — Private Information Retrieval demo
 * Protocol: 2-server IT-PIR (Chor et al., 1995)
 * "It is the glory of God to conceal a matter..." — Proverbs 25:2
 */

import type { Book } from './types.ts';

export const CATALOG: Book[] = [
  { id: 0,  title: "The Midnight Library",          author: "Matt Haig",           year: 2020, genre: "Fiction"      },
  { id: 1,  title: "Educated",                      author: "Tara Westover",       year: 2018, genre: "Memoir"       },
  { id: 2,  title: "Atomic Habits",                 author: "James Clear",         year: 2018, genre: "Self-Help"    },
  { id: 3,  title: "The Name of the Wind",          author: "Patrick Rothfuss",    year: 2007, genre: "Fantasy"      },
  { id: 4,  title: "Sapiens",                       author: "Yuval Noah Harari",   year: 2011, genre: "History"      },
  { id: 5,  title: "Where the Crawdads Sing",       author: "Delia Owens",         year: 2018, genre: "Mystery"      },
  { id: 6,  title: "Project Hail Mary",             author: "Andy Weir",           year: 2021, genre: "Sci-Fi"       },
  { id: 7,  title: "The Remains of the Day",        author: "Kazuo Ishiguro",      year: 1989, genre: "Literary"     },
  { id: 8,  title: "Thinking, Fast and Slow",       author: "Daniel Kahneman",     year: 2011, genre: "Psychology"   },
  { id: 9,  title: "Normal People",                 author: "Sally Rooney",        year: 2018, genre: "Fiction"      },
  { id: 10, title: "The Overstory",                 author: "Richard Powers",      year: 2018, genre: "Literary"     },
  { id: 11, title: "Bad Blood",                     author: "John Carreyrou",      year: 2018, genre: "Non-Fiction"  },
  { id: 12, title: "A Court of Thorns and Roses",   author: "Sarah J. Maas",       year: 2015, genre: "Fantasy"      },
  { id: 13, title: "Becoming",                      author: "Michelle Obama",      year: 2018, genre: "Memoir"       },
  { id: 14, title: "The Woman in the Window",       author: "A.J. Finn",           year: 2018, genre: "Thriller"     },
  { id: 15, title: "An American Marriage",          author: "Tayari Jones",        year: 2018, genre: "Fiction"      },
  { id: 16, title: "The Subtle Art of Not Giving",  author: "Mark Manson",         year: 2016, genre: "Self-Help"    },
  { id: 17, title: "Recursion",                     author: "Blake Crouch",        year: 2019, genre: "Sci-Fi"       },
  { id: 18, title: "Such a Fun Age",                author: "Kiese Laymon",        year: 2019, genre: "Fiction"      },
  { id: 19, title: "The Code Breaker",              author: "Walter Isaacson",     year: 2021, genre: "Science"      },
  { id: 20, title: "Piranesi",                      author: "Susanna Clarke",      year: 2020, genre: "Fantasy"      },
  { id: 21, title: "Empire of Pain",                author: "Patrick Radden Keefe",year: 2021, genre: "Non-Fiction"  },
  { id: 22, title: "The Lincoln Highway",           author: "Amor Towles",         year: 2021, genre: "Historical"   },
  { id: 23, title: "Four Thousand Weeks",           author: "Oliver Burkeman",     year: 2021, genre: "Self-Help"    },
  { id: 24, title: "Matrix",                        author: "Lauren Groff",        year: 2021, genre: "Historical"   },
  { id: 25, title: "Bewilderment",                  author: "Richard Powers",      year: 2021, genre: "Literary"     },
  { id: 26, title: "Cloud Cuckoo Land",             author: "Anthony Doerr",       year: 2021, genre: "Fiction"      },
  { id: 27, title: "The Anthropocene Reviewed",     author: "John Green",          year: 2021, genre: "Essays"       },
  { id: 28, title: "Five Tuesdays in Winter",       author: "Lily King",           year: 2021, genre: "Short Stories"},
  { id: 29, title: "Sea of Tranquility",            author: "Emily St. John Mandel",year: 2022, genre: "Sci-Fi"      },
  { id: 30, title: "Lessons in Chemistry",          author: "Bonnie Garmus",       year: 2022, genre: "Fiction"      },
  { id: 31, title: "Tomorrow, and Tomorrow",        author: "Gabrielle Zevin",     year: 2022, genre: "Literary"     },
];

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
if (DATABASE.length !== 32) {
  throw new Error(`DATABASE integrity check failed: expected 32 entries, got ${DATABASE.length}`);
}
