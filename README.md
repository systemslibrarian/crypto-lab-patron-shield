# crypto-lab-patron-shield

## What It Is

This project is a browser demo of Two-Server Information-Theoretic Private Information Retrieval (IT-PIR), implemented from the Chor et al. (1995) protocol shown in the app and code. It demonstrates how a user can retrieve one catalog entry without revealing which entry was requested to either server. The problem it solves is query privacy for database lookups, especially in library-search settings where search logs expose sensitive interests. The security model is two-server, non-colluding, information-theoretic privacy rather than computational hardness.

## When to Use It

- Use it for educational cryptography demos where users need to see exactly how two-server IT-PIR queries and XOR reconstruction work. It fits because the UI exposes each protocol phase and intermediate values.
- Use it to teach privacy-preserving library catalog concepts in workshops or classes. It fits because the catalog metaphor maps directly to sensitive query privacy.
- Use it as a starting point for front-end protocol visualization patterns. It fits because the state machine and rendering logic are separated and easy to extend.
- Do NOT use it as a production PIR service backend — it is a teaching demo, a client-side demonstration with simulated servers and no real distributed server trust boundary.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-patron-shield](https://systemslibrarian.github.io/crypto-lab-patron-shield/)**

In the demo, you can choose a catalog title, run a private query, and watch each step of IT-PIR execution from mask generation through response reconstruction. After a run, the privacy analysis makes the protocol's one trust assumption explicit — the two servers must not collude — and lets you trigger a **collusion attack** that XORs the two query masks (`S ⊕ S′ = {i}`) to recover your exact book, showing precisely what the non-collusion assumption protects. You can also switch between the naive query view and PIR view to compare what a server learns in each model. Controls include book selection, catalog show-all toggle, query execution buttons, the collusion-attack toggle, and the naive/PIR comparison toggle.

## What Can Go Wrong

- **Server collusion breaks everything:** if the two servers share their query masks, XORing them (`S ⊕ S′ = {i}`) reveals the requested index — exactly the attack the demo lets you trigger.
- **Metadata is not protected:** two-server IT-PIR hides the index, not the query timing, frequency, size, IP address, or the fact that a query happened at all.
- **O(n) communication:** each query touches the entire database, so naive IT-PIR does not scale to large catalogs without further engineering (e.g. RAID-PIR-style optimizations).
- **PRNG quality matters:** the privacy proof depends on a uniformly random mask; a biased or predictable PRNG for subset selection weakens or destroys the guarantee.
- **Scope is the lookup only:** it protects the catalog query, not any downstream borrowing transaction or logs the surrounding application keeps outside the protocol.

## Real-World Usage

- **RAID-PIR (Demmler, Herzberg, and Schneider, CCSW 2014):** makes multi-server IT-PIR practical over databases with millions of records using RAID-style XOR parity.
- **Percy++ (Ian Goldberg, University of Waterloo):** an open-source reference library implementing IT-PIR and computational PIR, used in privacy research.
- **PIR-Tor (Mittal et al., 2011):** proposes IT-PIR so Tor clients can fetch relay descriptors without revealing which relays they intend to use.
- **Checklist (Kogan and Corrigan-Gibbs, USENIX Security 2021):** private blocklist lookups — a two-server PIR protocol lets a browser check a URL against Google's Safe Browsing list without revealing the URL.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-patron-shield
cd crypto-lab-patron-shield
npm install
npm run dev
```

## Tests / Verification

Prove the crypto yourself — don't take the README's word for it.

```bash
npm test            # PIR correctness self-audit (vitest, src/pir.test.ts)
npm run build       # tsc type-check + production bundle
npm run test:e2e    # both browser suites — what CI gates the deploy on
npm run test:a11y   # WCAG A/AA gate only (Playwright + axe-core, both themes)
npm run test:claims # on-screen claims gate only
```

`npm test` runs the unit suite that backs every claim on this page:

- **Correctness (known-answer test).** For every catalog index, `r1 ⊕ r2`
  reconstructs the stored record **byte for byte — all 64, title and author** —
  checked across 500 random masks and for **both** cases of the reconstruction
  proof (target bit set vs. clear), against the database that was *supplied*
  rather than the module's global catalog. A title-only check would call a record
  with a corrupted author "Correct"; `recordsMatch` is tested directly against
  exactly that counterexample.
- **Privacy by construction.** The two query masks differ in **exactly one** bit,
  and that bit is the target index (`S ⊕ S′ = 1 << i`); masks stay within
  `DB_SIZE` bits and are freshly random each run.
- **The collusion attack really works — at every index the mask width allows.**
  `recoverByCollusion` recovers exactly the queried index from both masks (100
  trials/index), and correctly returns `-1` for inputs that are not a valid
  one-bit-differing query pair. It is exercised over a synthetic **32**-record
  database, index 31 included: `maskS ^ maskSPrime` is a *signed* int32, so with
  bit 31 set the XOR is negative, the power-of-two guard passes anyway, and
  `Math.log2` of a negative is `NaN`. That is the one index the `DB_SIZE ≤ 32`
  limit permits and the old implementation could not recover.
- **Index validation.** `generateQuery` rejects non-integer indices. `NaN` used to
  pass a comparison-only range check (`NaN < 0` and `NaN >= DB_SIZE` are both
  false) and be coerced to bit 0 by the shift, producing a structurally valid
  query for record 0 while reporting `differingBit: NaN`.
- **Database shape.** `runServer` takes its record count *and* record length from
  the database it is handed — not a global and not a hardcoded 64 — and rejects
  empty databases, unequal record lengths, and mask bits naming records that do
  not exist.
- **Encoding.** Field truncation happens at UTF-8 code-point boundaries, so a
  multibyte title or author can never decode to a replacement character.
- **Oracle linearity + plumbing.** `runServer` behaves as a linear XOR oracle
  (single-bit mask returns exactly that record; `server(m1) ⊕ server(m2) =
  server(m1 ⊕ m2)`), `xorBytes` is self-inverse, and records encode to a fixed
  64-byte layout.

CI (`.github/workflows/deploy.yml`) runs `npm test` **before** the build, so a
broken protocol blocks the deploy — the accessibility gate then runs the same
way.

The browser suite (`npm run test:e2e`) additionally gates the claims the page
*renders*: that the √N column mask can address every record at every slider
position (`side² ≥ N > (side-1)²`, not merely that it equals the page's own
formula), that the scaling figures are labelled as query bits only, that privacy
is scoped to the requested index, that the trust model does not sell
"at least one server is honest" as buying correctness, and that the skip link
reaches a region that exists and takes focus.

**Implementation limit (honest disclosure):** the live 1-D protocol packs each
query mask into a single 32-bit integer, so it is capped at `DB_SIZE ≤ 32`
records (the catalog here is 8). That is a JavaScript-number convenience, not a
property of PIR. The O(n)-communication scaling lesson is therefore *illustrated*
by the √N slider in the app rather than by growing the live database; a
production build would use a bit-vector or the √N matrix layout.

## Related Demos

- [crypto-lab-oblivious-shelf](https://systemslibrarian.github.io/crypto-lab-oblivious-shelf/) — sibling 2-server IT-PIR demo with a step-by-step privacy audit.
- [crypto-lab-oram-vault](https://systemslibrarian.github.io/crypto-lab-oram-vault/) — Path ORAM hides access patterns rather than a single query index.
- [crypto-lab-psi-gate](https://systemslibrarian.github.io/crypto-lab-psi-gate/) — private set intersection for contact discovery.
- [crypto-lab-silent-tally](https://systemslibrarian.github.io/crypto-lab-silent-tally/) — Shamir-based MPC secure sum.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
