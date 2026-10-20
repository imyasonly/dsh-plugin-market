import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'market-update-check-'));
import { addDshPlugin, removeDshPlugin, runDshPlugin, configureDesktopPluginManager, publicInstallStatus } from '../lib/dsh-cli.js';

const target = '@dickpy/dsh-imagegen@1.9.2';
let calls = [];
configureDesktopPluginManager(() => ({
  async installBundle(spec, options) {
    calls.push(['install', spec, options]);
    assert.equal(publicInstallStatus().active, true);
    return { application: 'restart-required', packageResult: { exitCode: 0, output: 'updated', logPath: 'manager/pnpm.log' } };
  },
  async removeBundle(name) {
    calls.push(['remove', name]);
    return { application: 'applied', packageResult: { exitCode: 0, output: 'removed' } };
  },
}));
assert.equal(await addDshPlugin(target, 'desktop'), 'updated');
assert.deepEqual(calls[0], ['install', target, { enabled: false }]);
assert.equal(publicInstallStatus().active, false);
assert.equal(publicInstallStatus().error, null);
assert.equal(publicInstallStatus().logPath, 'manager/pnpm.log');
assert.equal(await removeDshPlugin('@dickpy/dsh-imagegen', 'desktop'), 'removed');
assert.deepEqual(calls[1], ['remove', '@dickpy/dsh-imagegen']);

for (const result of [
  { application: 'failed', error: { code: 'operation-error', diagnostic: 'manager refused' } },
  { application: 'failed', error: { code: 'incompatible-version' } },
  { application: 'cancelled' },
  { application: 'restart-required', packageResult: { exitCode: 1, output: 'pnpm failed' } },
  { application: 'restart-required', packageResult: { exitCode: 0, timedOut: true, output: 'timed out' } },
]) {
  let attempts = 0;
  configureDesktopPluginManager(() => ({ async installBundle() { attempts++; return result; } }));
  await assert.rejects(addDshPlugin(target, 'desktop'));
  assert.equal(attempts, 1, 'desktop failures must not trigger CLI repair retries');
  assert.equal(publicInstallStatus().active, false);
  assert.ok(publicInstallStatus().error);
}
configureDesktopPluginManager(() => undefined);
await assert.rejects(addDshPlugin(target, 'desktop'), /pluginManager/);
assert.equal(publicInstallStatus().logPath, null);
await assert.rejects(runDshPlugin('desktop', ['install', '--no-frozen-lockfile']), /桌面端插件管理器/);
await assert.rejects(addDshPlugin('--bad target', 'desktop'), /不安全/);

// Current HMR hosts refuse replacing installed bundles until the old one is removed.
for (const enabled of [true, false]) {
  for (const failUpdate of [false, true]) {
    const steps = [];
    configureDesktopPluginManager(() => ({
      async listBundles() { return [{ name: '@dickpy/dsh-imagegen', enabled, version: '1.0.0', source: '^1.0.0', removable: true }]; },
      async removeBundle(name) { steps.push(['remove', name]); return { application: 'applied' }; },
      async installBundle(spec, options) {
        steps.push(['install', spec, options]);
        if (steps.length === 1) return { application: 'failed', error: { code: 'already-installed' } };
        if (failUpdate && spec === target) return { application: 'failed', error: { diagnostic: 'network failed' } };
        return { application: 'applied', packageResult: { exitCode: 0, output: 'updated' } };
      },
    }));
    if (failUpdate) await assert.rejects(addDshPlugin(target, 'desktop'), /已恢复旧版/);
    else assert.equal(await addDshPlugin(target, 'desktop'), 'updated');
    assert.deepEqual(steps.slice(1, 3), [
      ['remove', '@dickpy/dsh-imagegen'], ['install', target, { enabled }],
    ]);
    if (failUpdate) assert.deepEqual(steps[3], ['install', '@dickpy/dsh-imagegen@1.0.0', { enabled }]);
  }
}
// A protected bundle must never be removed.
configureDesktopPluginManager(() => ({
  async installBundle() { return { application: 'failed', error: { code: 'already-installed' } }; },
  async listBundles() { return [{ name: '@dickpy/dsh-imagegen', enabled: true, removable: false }]; },
  async removeBundle() { assert.fail('protected bundle was removed'); },
}));
await assert.rejects(addDshPlugin(target, 'desktop'), /保护/);

// A reload deferred by the host must preserve enablement across a restart/retry.
let stopped = false;
let retryInstall = false;
configureDesktopPluginManager(() => ({
  async listBundles() { return [{ name: '@dickpy/dsh-imagegen', enabled: !stopped, version: '1.0.0', source: '^1.0.0', removable: true }]; },
  async removeBundle() {
    if (!stopped) { stopped = true; return { application: 'failed', error: { code: 'bundle-in-use' } }; }
    retryInstall = true;
    return { application: 'applied' };
  },
  async installBundle(spec, options) {
    if (!retryInstall) return { application: 'failed', error: { code: 'already-installed' } };
    assert.equal(options.enabled, true, 'retry must restore original enabled state');
    return { application: 'applied', packageResult: { exitCode: 0, output: 'updated' } };
  },
}));
await assert.rejects(addDshPlugin(target, 'desktop'), /完全退出/);
assert.equal(await addDshPlugin(target, 'desktop'), 'updated');

// Legacy profile overlays load entries independently of bundle selection.
const entryCalls = [];
let entryRunning = true;
let entryRemoved = false;
configureDesktopPluginManager(() => ({
  async listBundles() { return [{ name: '@dickpy/dsh-imagegen', enabled: false, version: '1.0.0', source: '^1.0.0', removable: true }]; },
  async listPlugins() { return [{ entryId: 'include:imagegen', moduleName: '@dickpy/dsh-imagegen', enabled: entryRunning }]; },
  async setPluginEnabled(id, enabled) { entryCalls.push([id, enabled]); entryRunning = enabled; return { application: 'applied' }; },
  async removeBundle() { assert.equal(entryRunning, false); entryRemoved = true; return { application: 'applied' }; },
  async installBundle() {
    return entryRemoved ? { application: 'applied', packageResult: { exitCode: 0, output: 'updated' } }
      : { application: 'failed', error: { code: 'already-installed' } };
  },
}));
assert.equal(await addDshPlugin(target, 'desktop'), 'updated');
assert.deepEqual(entryCalls, [['include:imagegen', false], ['include:imagegen', true]]);
assert.equal(entryRunning, true);

// pnpm 11 can hide the dependency still in minimumReleaseAge behind an internal callback error.
let policyAttempt = 0;
configureDesktopPluginManager(() => ({
  async listBundles() { return [{ name: '@dickpy/dsh-imagegen', enabled: false, version: '1.0.0', source: '^1.0.0', removable: true }]; },
  async removeBundle() { return { application: 'applied' }; },
  async installBundle(spec) {
    policyAttempt += 1;
    if (policyAttempt === 1) return { application: 'failed', error: { code: 'already-installed' } };
    if (spec === target) return { application: 'failed', error: { diagnostic: '[ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED] no handleResolutionPolicyViolations callback' } };
    return { application: 'applied', packageResult: { exitCode: 0, output: 'restored' } };
  },
}));
await assert.rejects(addDshPlugin(target, 'desktop'), /minimumReleaseAge.*等待发布满 24 小时.*已恢复旧版/);

const localApi = await readFile(new URL('../src/local-api.ts', import.meta.url), 'utf8');
const updateRoute = localApi.slice(localApi.indexOf("method === 'pluginUpdate'"), localApi.indexOf("method === 'pluginCustomInstall'"));
assert.doesNotMatch(updateRoute, /fetchLatestVersions\(/, 'clicking update must reuse the version-list snapshot');
assert.match(updateRoute, /body\.targetVersion/, 'update endpoint must accept the version shown by the list');
assert.match(updateRoute, /SELF_VERSION_RE\.test\(targetVersion\)/, 'server must validate the supplied exact version');
assert.match(updateRoute, /`\$\{pkg\}@\$\{targetVersion\}`/, 'updates must use that exact package version');
assert.doesNotMatch(updateRoute, /dsh-imagegen|minimumReleaseAgeExclude|writeMinimumReleaseAgeExclude/, 'update route must not special-case packages or alter supply-chain policy');

const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
assert.match(client, /pluginUpdate', \{ pkg: item\.pkg, profile: item\.profile, targetVersion: item\.latest \}/);
assert.match(client, /const targetVersion = latestMap\.get\(item\.pkg\)\?\.latest \|\| ''/);
assert.match(client, /pluginUpdate', \{ pkg: item\.pkg, profile: item\.profile, targetVersion \}/);
const skills = client.slice(client.indexOf('{/* 技能更新 */}'), client.indexOf('{note ?', client.indexOf('{/* 技能更新 */}')));
assert.equal((skills.match(/onClick=\{updateAll\}/g) || []).length, 1);
assert.equal((skills.match(/onClick=\{load\}/g) || []).length, 1);
console.log('PASS: desktop manager dispatch, progress, failure handling, no CLI fallback, and unique skill actions');
