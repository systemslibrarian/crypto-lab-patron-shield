# patron-shield

**A browser-based interactive demo of Two-Server Information-Theoretic Private Information Retrieval (IT-PIR) applied to library catalog privacy.**

Live demo: **https://systemslibrarian.github.io/patron-shield/**

---

## What is this?

Every time you search a library catalog, the server learns what you looked for. Your reading interests — medical diagnoses, legal research, personal struggles — are logged, retained, and potentially disclosed.

**Private Information Retrieval (PIR)** solves this: you can retrieve any item from a database and the server learns *nothing* about which item you chose. The guarantee isn't based on computational hardness. It's **information-theoretic** — it holds even against a server with unlimited computing power.

This project implements the 1995 Chor–Goldreich–Kushilevitz–Sudan two-server IT-PIR protocol as a fully interactive educational demo. A visitor can select any of 32 books from a library catalog, click "Query Privately," and watch the complete protocol execute step-by-step: bitmask generation, XOR computation on both simulated servers, and final reconstruction — with the book title emerging from a cryptographic XOR.

---

## The Protocol

### Non-technical overview

The idea is elegant: instead of asking one server for a book, you ask two servers — both of which hold the same database. You craft a pair of random-looking bitmasks such that if both servers XOR-sum the books their mask selects, the two results cancel out to reveal exactly the book you wanted. Each server sees only a random bitmask. Neither learns which book you care about.

### Technical description (Chor et al., 1995)

Given a database of `N = 32` books (each encoded as 64 bytes), and a client who wants item at index `i` (0 ≤ i ≤ 31):

1. **Client generates a query pair:**
	- `S` = uniformly random 32-bit integer (using `crypto.getRandomValues`)
	- `S′` = `S XOR (1 << i)` — identical to `S` but with bit `i` flipped

2. **Server 1** receives `S`, computes `r₁ = XOR of db[j] for all j where bit j of S is set`

3. **Server 2** receives `S′`, computes `r₂ = XOR of db[j] for all j where bit j of S′ is set`

4. **Client reconstructs** `db[i] = r₁ ⊕ r₂`

**Why it works:** If bit `i` is set in `S`, then `S′ = S \ {i}`:
- r₁ = db[i] ⊕ (XOR of db[j] for j ≠ i in S)
- r₂ = XOR of db[j] for j ≠ i in S
- r₁ ⊕ r₂ = db[i] ✓

---

## The Privacy Guarantee

**Server 1** sees `S` — a value drawn uniformly at random from all 32-bit integers. It contains no information about `i`.

**Server 2** sees `S′ = S XOR (1 << i)`. Since `S` is uniform, `S′` is also uniform (XOR with any fixed constant preserves the uniform distribution). Server 2 cannot determine `i` either.

The guarantee is **information-theoretic**, not computational. Both servers could have infinite computing power and still learn nothing.

The only assumption is that the two servers do not collude.

---

## Running locally

```bash
git clone https://github.com/systemslibrarian/patron-shield.git
cd patron-shield
npm install
npm run dev
```

Then open `http://localhost:5173/patron-shield/`.

---

## Building

```bash
npm run build
```

Output goes to `dist/`. Deploy to GitHub Pages with:

```bash
npm run deploy
```

---

## Why a librarian built this

The American Library Association's [Library Bill of Rights](https://www.ala.org/advocacy/intfreedom/librarybill) establishes a clear principle: **patron reading records are confidential**. Libraries have a long tradition of refusing to disclose what patrons read, fighting subpoenas, and destroying circulation records to protect intellectual freedom.

But this ethical commitment runs into a technical wall. Modern library catalogs are web applications. Every search query touches a server. The server knows. The server logs.

Private Information Retrieval offers a cryptographic path to honoring the spirit of patron privacy in digital systems — not through policy, but through mathematics. The server genuinely cannot know what you were looking for, because the protocol prevents it.

— **Paul Clark**, Systems Librarian, Leon County Public Library — Florida Librarian of the Year 2011

---

## Part of the systemslibrarian crypto portfolio

This project is part of **[crypto-compare](https://systemslibrarian.github.io/crypto-compare/?cat=ot_pir)** — a collection of interactive cryptographic primitive demonstrations.

After deploying, add this project to `crypto-compare`'s OT/PIR category with label:
> *patron-shield — 2-server IT-PIR for library catalog privacy*

---

## Reference

> Chor, B., Goldreich, O., Kushilevitz, E., & Sudan, M. (1995).
> **"Private information retrieval."**
> *Proceedings of the 36th Annual Symposium on Foundations of Computer Science (FOCS 1995)*, pp. 41–50.

---

## Stack

- **Vite 5** + **TypeScript 5** (strict mode)
- Zero dependencies beyond Vite and TypeScript
- All PIR math is hand-rolled `Uint8Array` XOR operations
- No React, no crypto libraries, no backend
- Static output: `dist/` → GitHub Pages

---

## License

MIT © 2024 Paul Clark