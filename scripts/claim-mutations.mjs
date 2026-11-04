// Replay concrete faults against the assertion that owns each security or
// correctness claim. Every mutant must build, change dist/, die by assertion,
// restore byte-for-byte, and leave its owning test green again.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = [npmCommand, ['run', 'build']];
const vitest = (file, title) => [
  process.execPath,
  [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', file, '--testNamePattern', title],
];

function run([command, args]) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
}

function pass(command, label) {
  const result = run(command);
  if (result.status !== 0) {
    throw new Error(`${label}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function distHash() {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const pathname = join(directory, entry.name);
      if (entry.isDirectory()) walk(pathname);
      else {
        hash.update(pathname);
        hash.update(readFileSync(pathname));
      }
    }
  };
  walk('dist');
  return hash.digest('hex');
}

const cases = [
  [
    'query randomness is replaced by a constant mask',
    'src/pir.ts',
    '  const maskS = (rand[0] & lowBitsMask(dbSize)) >>> 0;',
    '  const maskS = (0 & lowBitsMask(dbSize)) >>> 0;',
    vitest('src/pir.test.ts', 'produces a fresh random mask across runs'),
  ],
  [
    'non-integer target indices are accepted',
    'src/pir.ts',
    '  if (!Number.isInteger(targetIndex)) {',
    '  if (false && !Number.isInteger(targetIndex)) {',
    vitest('src/pir.test.ts', 'rejects NaN — which used to pass the range check'),
  ],
  [
    'non-integer server masks are coerced',
    'src/pir.ts',
    '  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff) {',
    '  if (false && (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff)) {',
    vitest('src/pir.test.ts', 'rejects values that bitwise coercion would silently turn into another mask'),
  ],
  [
    'server masks may name nonexistent records',
    'src/pir.ts',
    '  if ((unsignedMask & ~lowBitsMask(size)) >>> 0) {',
    '  if (false && ((unsignedMask & ~lowBitsMask(size)) >>> 0)) {',
    vitest('src/pir.test.ts', 'rejects mask bits that name records outside the database'),
  ],
  [
    'reconstruction verdict ignores author bytes',
    'src/pir.ts',
    '  return bytesEqual(reconstructed, expected);',
    '  return bytesEqual(reconstructed.subarray(0, 48), expected.subarray(0, 48));',
    vitest('src/pir.test.ts', 'recordsMatch rejects a record whose AUTHOR bytes were altered'),
  ],
  [
    'bit-31 collusion recovery uses Math.log2 on the signed XOR',
    'src/pir.ts',
    '  return 31 - Math.clz32(diff);',
    '  return Math.log2(maskS ^ maskSPrime);',
    vitest('src/pir.test.ts', 'recovers index 31 from a mask pair whose XOR sets the sign bit'),
  ],
  [
    'UTF-8 truncation slices through code points',
    'src/catalog.ts',
    '  const buf = new Uint8Array(maxBytes);\n  const { written } = encoder.encodeInto(text, buf);\n  return buf.subarray(0, written);',
    '  return encoder.encode(text).slice(0, maxBytes);',
    vitest('src/pir.test.ts', 'never produces a replacement character, at any cut point'),
  ],
  [
    'the second query mask no longer flips the requested bit',
    'src/pir.ts',
    '  const maskSPrime = (maskS ^ (1 << targetIndex)) >>> 0;',
    '  const maskSPrime = maskS;',
    vitest('src/pir.test.ts', 'masks differ in exactly one bit, and that bit is the target index'),
  ],
];

const sourceFiles = [...new Set(cases.map((entry) => entry[1]))];
const dirty = spawnSync('git', ['diff', '--exit-code', '--', ...sourceFiles], {
  cwd: root,
  encoding: 'utf8',
});
if (dirty.status !== 0) {
  throw new Error('Commit the source baseline before mutation checks.');
}

pass(build, 'baseline build');
const baseline = distHash();
const evidence = [];
console.log('baseline: unmutated copy PASSES');
mkdirSync('mutation-logs', { recursive: true });

for (const [name, file, before, after, owner] of cases) {
  pass(owner, `${name}: baseline owner`);
  const original = readFileSync(file, 'utf8');
  if (original.split(before).length !== 2) {
    throw new Error(`${name}: expected exactly one mutation site`);
  }

  let restoredBuild;
  let restoredHash;
  let restoredOwner;
  try {
    writeFileSync(file, original.replace(before, after));
    const sourceDiff = spawnSync('git', ['diff', '--', file], {
      cwd: root,
      encoding: 'utf8',
    }).stdout;
    if (!sourceDiff.trim()) throw new Error(`${name}: source diff is empty`);

    pass(build, `${name}: mutant build`);
    const mutant = distHash();
    if (mutant === baseline) throw new Error(`${name}: production artifact did not move`);

    const result = run(owner);
    const output = result.stdout + result.stderr;
    const logName = name.replaceAll(/[^A-Za-z0-9.-]+/g, '-').replace(/^-|-$/g, '');
    writeFileSync(`mutation-logs/${logName}.log`, output);
    if (
      result.status === 0 ||
      !/AssertionError|expected|FAIL|Test Files\s+\d+ failed/i.test(output)
    ) {
      throw new Error(`${name}: no assertion kill\n${output}`);
    }

    evidence.push({
      name,
      sourceDiff,
      baseline,
      mutant,
      namedTest: owner[1][owner[1].indexOf('--testNamePattern') + 1],
      assertionFailure: true,
      retries: 0,
    });
  } finally {
    writeFileSync(file, original);
    restoredBuild = run(build);
    if (restoredBuild.status === 0) restoredHash = distHash();
    restoredOwner = run(owner);
  }

  if (restoredBuild.status !== 0) {
    throw new Error(`${name}: restore build failed\n${restoredBuild.stdout}\n${restoredBuild.stderr}`);
  }
  if (restoredHash !== baseline) throw new Error(`${name}: restored artifact hash differs`);
  if (restoredOwner.status !== 0) {
    throw new Error(`${name}: restored owner failed\n${restoredOwner.stdout}\n${restoredOwner.stderr}`);
  }
  evidence.at(-1).restoredGreen = true;
  console.log(`${name}: killed; exact artifact restored; owning test green`);
}

writeFileSync('mutation-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`all ${cases.length} mutation(s) caught`);
