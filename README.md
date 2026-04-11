# patron-shield

## 1. What It Is
This project is a browser demo of Two-Server Information-Theoretic Private Information Retrieval (IT-PIR), implemented from the Chor et al. (1995) protocol shown in the app and code. It demonstrates how a user can retrieve one catalog entry without revealing which entry was requested to either server. The problem it solves is query privacy for database lookups, especially in library-search settings where search logs expose sensitive interests. The security model is two-server, non-colluding, information-theoretic privacy rather than computational hardness.

## 2. When to Use It
- Use it for educational cryptography demos where users need to see exactly how two-server IT-PIR queries and XOR reconstruction work. It fits because the UI exposes each protocol phase and intermediate values.
- Use it to teach privacy-preserving library catalog concepts in workshops or classes. It fits because the catalog metaphor maps directly to sensitive query privacy.
- Use it as a starting point for front-end protocol visualization patterns. It fits because the state machine and rendering logic are separated and easy to extend.
- Do not use it as a production PIR service backend. It is a client-side demonstration with simulated servers and no real distributed server trust boundary.

## 3. Live Demo
Live GitHub Pages demo: https://systemslibrarian.github.io/crypto-lab-patron-shield/

In the demo, you can choose a catalog title, run a private query, and watch each step of IT-PIR execution from mask generation through response reconstruction. You can also switch between the naive query view and PIR view to compare what a server learns in each model. Controls include book selection, catalog show-all toggle, query execution buttons, and the naive/PIR comparison toggle.

## 4. How to Run Locally
```bash
git clone https://github.com/systemslibrarian/crypto-lab-patron-shield.git
cd crypto-lab-patron-shield
npm install
npm run dev
```

No environment variables are required.

## 5. Part of the Crypto-Lab Suite
This demo is part of the broader Crypto-Lab collection at https://systemslibrarian.github.io/crypto-lab/.

Whether you eat or drink or whatever you do, do it all for the glory of God. - 1 Corinthians 10:31
