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

- **RAID-PIR (Devet and Goldberg, 2014):** makes multi-server IT-PIR practical over databases with millions of records using RAID-style XOR parity.
- **Percy++ (Ian Goldberg, University of Waterloo):** an open-source reference library implementing IT-PIR and computational PIR, used in privacy research.
- **PIR-Tor (Mittal et al., 2011):** proposes IT-PIR so Tor clients can fetch relay descriptors without revealing which relays they intend to use.
- **Checklist (Henry and Goldberg, 2013):** a privacy-preserving messaging system built on IT-PIR for reading bulletin-board messages without revealing which.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-patron-shield
cd crypto-lab-patron-shield
npm install
npm run dev
```

## Related Demos

- [crypto-lab-oblivious-shelf](https://systemslibrarian.github.io/crypto-lab-oblivious-shelf/) — sibling 2-server IT-PIR demo with a step-by-step privacy audit.
- [crypto-lab-oram-vault](https://systemslibrarian.github.io/crypto-lab-oram-vault/) — Path ORAM hides access patterns rather than a single query index.
- [crypto-lab-psi-gate](https://systemslibrarian.github.io/crypto-lab-psi-gate/) — private set intersection for contact discovery.
- [crypto-lab-silent-tally](https://systemslibrarian.github.io/crypto-lab-silent-tally/) — Shamir-based MPC secure sum.

---

*One of 60+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
