import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowDir = join(root, '.github', 'workflows');
const read = (name) => readFileSync(join(workflowDir, name), 'utf8');

test('every third-party action is pinned to a full commit', () => {
  const violations = [];
  for (const name of readdirSync(workflowDir).filter((entry) => /\.ya?ml$/.test(entry))) {
    for (const match of read(name).matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      const reference = match[1];
      if (reference.startsWith('./')) continue;
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(reference)) {
        violations.push(`${name}: ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('source-running jobs have read-only repository authority', () => {
  const browser = read('browser-gate.yml');
  const ci = read('ci.yml');
  const deploy = read('deploy.yml');
  const deployPreamble = deploy.slice(0, deploy.indexOf('\njobs:'));
  const deployJob = deploy.slice(deploy.indexOf('\n  deploy:'));

  assert.match(browser, /permissions:\n {2}contents: read/);
  assert.match(ci, /permissions:\n {2}contents: read/);
  assert.match(deployPreamble, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(deployPreamble, /pages:\s*write|id-token:\s*write/);
  assert.match(deployJob, /permissions:\n {6}pages: write\n {6}id-token: write/);
  assert.doesNotMatch(deployJob, /actions\/checkout|npm\s/);
});

test('deploys never run on pull requests or cancel main publication', () => {
  const deploy = read('deploy.yml');
  const trigger = deploy.slice(0, deploy.indexOf('\npermissions:'));
  assert.doesNotMatch(trigger, /pull_request/);
  assert.match(deploy, /concurrency:[\s\S]*cancel-in-progress: false/);
});

test('CI tests every supported Node major from the exact lockfile', () => {
  const ci = read('ci.yml');
  const browser = read('browser-gate.yml');
  assert.match(ci, /node:\s*\[22, 24, 26\]/);
  for (const source of [ci, browser]) {
    assert.match(source, /npm ci/);
    assert.match(source, /npm audit --audit-level=high/);
    assert.doesNotMatch(source, /npm install(?:\s|$)/);
  }
});

test('pull requests and deploys call the same complete browser gate', () => {
  const ci = read('ci.yml');
  const deploy = read('deploy.yml');
  const browser = read('browser-gate.yml');
  assert.match(ci, /uses: \.\/\.github\/workflows\/browser-gate\.yml/);
  assert.match(deploy, /uses: \.\/\.github\/workflows\/browser-gate\.yml/);
  assert.match(browser, /run: npm run test:e2e/);
  assert.match(browser, /run: npm run test:mutations/);
  assert.match(browser, /mutation-evidence\.json/);
  assert.match(browser, /if: inputs\.upload_pages_artifact/);
});

test('Dependabot leaves majors open and fails closed', () => {
  const ci = read('ci.yml');
  assert.match(ci, /update-type == 'version-update:semver-major'/);
  assert.match(ci, /update-type == 'version-update:semver-minor'/);
  assert.match(ci, /update-type == 'version-update:semver-patch'/);
  assert.match(ci, /if \[ "\$merged" != true \]; then[\s\S]*exit 1/);
  assert.match(ci, /if ! gh workflow run deploy\.yml[\s\S]*exit 1/);
  assert.doesNotMatch(ci, /::warning::|exit 0/);
});
