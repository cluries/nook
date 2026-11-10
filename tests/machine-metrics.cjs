const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mods/nook-spaces/main.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ')
  .replace('export default class ', 'globalThis.Mod = class ');
const context = { View: class {} };
vm.runInNewContext(source, context);
const parse = context.parseMetrics;
const sample = { cpu_active_ratio: 0.25, cpu_scaled_ratio: 0.1,
  memory: { ram_usage: 1073741824, ram_total: 2147483648 }, temp: { cpu_temp_avg: 40.25 } };
assert.equal(parse(JSON.stringify(sample)).cpu, '25');
assert.equal(parse(JSON.stringify(sample)).used, '1.0');
assert.equal(parse(JSON.stringify(sample)).temperature, '40.3');
sample.temp.cpu_temp_avg = null;
assert.equal(parse(JSON.stringify(sample)).temperature, null);
sample.cpu_active_ratio = 2;
assert.equal(parse(JSON.stringify(sample)), null);
assert.equal(parse('unavailable'), null);
assert.equal(parse('25 1.0 2.0'), null);
assert.throws(() => parse('{broken'));
// Linux uses the previous snapshot, includes steal, and uses available memory and reports cache/swap separately.
const linux = (counters, changes = {}) => JSON.stringify({ linux: true, boot: 'boot-a', counters,
  totalKiB: 2097152, availableKiB: 1572864, cacheKiB: 1048576, swapTotalKiB: 1048576, swapFreeKiB: 786432, ...changes });
const baseline = parse(linux([100, 0, 100, 800, 0, 0, 0, 0]));
assert.equal(baseline.cpu, null);
assert.equal(baseline.used, '0.5');
assert.equal(baseline.available, '1.5');
assert.equal(baseline.cache, '1.0');
assert.equal(baseline.swapUsed, '0.3');
assert.equal(baseline.swapTotal, '1.0');
assert.equal(parse(linux([110, 0, 110, 860, 0, 0, 0, 20]), baseline).cpu, '40');
assert.equal(parse(linux([110, 0, 110, 860, 0, 0, 0, 20], { boot: 'boot-b' }), baseline).cpu, null);
assert.equal(parse(linux([1, 0, 1, 1, 0, 0, 0, 0]), baseline).cpu, null);
assert.equal(parse(linux(baseline.counters), baseline).cpu, null);
const waiting = parse(linux([100, 0, 100, 800, 5, 0, 0, 0]));
assert.equal(parse(linux([110, 0, 110, 860, 4, 0, 0, 20]), waiting).cpu, null);
assert.equal(parse(linux([1, 2])), null);
assert.equal(parse(linux(baseline.counters, { availableKiB: 0 })).used, '2.0');
assert.equal(parse(linux(baseline.counters, { availableKiB: -1 })), null);
assert.equal(parse(linux(baseline.counters, { swapFreeKiB: 2097152 })), null);
assert.equal(parse(linux(baseline.counters, { swapFreeKiB: 0, swapTotalKiB: 0 })).swapUsed, '0.0');
assert.equal(parse(linux(baseline.counters, { availableKiB: 2097153 })), null);
async function linuxLive() {
  if (!process.env.NOOK_TEST_LINUX_MACHINE) return;
  const { execFileSync } = require('node:child_process');
  const script = vm.runInNewContext(source + '\nMETRICS', { View: class {} });
  const read = () => parse(execFileSync('hc', ['exec', '--on', process.env.NOOK_TEST_LINUX_MACHINE,
    'sh', '-c', script], { encoding: 'utf8', timeout: 5000 }));
  const first = read();
  assert.equal(first.linux, true);
  console.log('Remote memory GiB:', { used: first.used, available: first.available, cache: first.cache, swapUsed: first.swapUsed, swapTotal: first.swapTotal });
  await new Promise(resolve => setTimeout(resolve, 2000));
  const next = read();
  const result = parse(JSON.stringify({ linux: true, boot: next.boot, counters: next.counters,
    totalKiB: 2097152, availableKiB: 1572864, cacheKiB: 1048576, swapTotalKiB: 1048576, swapFreeKiB: 786432 }), first);
  assert.notEqual(result.cpu, null);
  console.log('Remote Linux: snapshot command, boot ID and cross-poll CPU delta passed.');
}
// Exercise the actual supervisor, JSON endpoint, PID reuse and explicit cleanup.
async function controller() {
  const view = new context.Mod();
  Object.assign(view, { metrics: {}, temperatureHistory: {}, metricsBusy: new Set(),
    metricServices: {}, metricLastPoll: {}, folded: new Set(), metricsClosed: false });
  let active = true, reply = { code: 0, stdout: '' };
  const calls = [], jobs = [];
  context.machines = () => [];
  context.window = () => ({ active });
  context.layout = () => null;
  context.exec = async (...args) => { calls.push(args); return reply; };
  let redraws = 0;
  const cx = { spawn(fn) { jobs.push(fn(cx)); }, notify() { redraws++; } };
  const poll = async () => { view.metricLastPoll = {}; view.refreshMetrics(cx); await Promise.all(jobs); };
  await poll();
  assert.equal(view.metrics[''].starting, true);
  const service = view.metricServices[''];
  reply = { code: 0, stdout: JSON.stringify({ cpu_active_ratio: 0.2,
    memory: { ram_usage: 1, ram_total: 2 }, temp: { cpu_temp_avg: 40 }, timestamp: new Date().toISOString() }) };
  await poll();
  assert.equal(view.temperatureHistory[''].length, 1);
  await poll();
  assert.equal(view.temperatureHistory[''].length, 1, 'Repeated snapshot must not duplicate a history point');
  const firstTime = view.temperatureHistory[''][0].time;
  let tick = 0;
  const backgroundPoll = async () => {
    tick++;
    reply = { code: 0, stdout: JSON.stringify({ cpu_active_ratio: 0.3,
      memory: { ram_usage: 1, ram_total: 2 }, temp: { cpu_temp_avg: 41 },
      timestamp: new Date(firstTime + tick * 2000).toISOString() }) };
    const before = redraws;
    await poll();
    assert.equal(calls.at(-1)[1].at(-1), 'read');
    assert.equal(redraws, before, 'Hidden samples must not request metric redraws');
    assert.equal(view.temperatureHistory[''].length, tick + 1, 'Hidden samples must extend history');
  };
  active = false;
  for (let i = 0; i < 6; i++) await backgroundPoll();
  active = true;
  view.folded.add('');
  await backgroundPoll();
  view.folded.clear();
  context.layout = () => ({ id: 'sidebar', size: { px: 100 } });
  await backgroundPoll();
  context.layout = () => null;
  const beforeResume = redraws;
  tick++;
  reply = { code: 0, stdout: JSON.stringify({ cpu_active_ratio: 0.3,
    memory: { ram_usage: 1, ram_total: 2 }, temp: { cpu_temp_avg: 42 },
    timestamp: new Date(firstTime + tick * 2000).toISOString() }) };
  await poll();
  assert.equal(redraws, beforeResume + 1, 'Visible samples must resume redraws');
  const history = view.temperatureHistory[''];
  assert.equal(history.length, tick + 1);
  assert.ok(history.slice(1).every((point, i) => point.time - history[i].time === 2000),
    'Background and resumed history must retain every sample without artificial gaps');
  assert.equal(view.metricServices[''], service, 'Polls reuse the same service');
  await view.close();
  const count = calls.length;
  await poll();
  assert.equal(calls.length, count, 'Closed mod must not restart its service');
  console.log('Controller: service reuse, snapshot deduplication, background history, redraw suppression, resume and close passed.');
}
async function live() {
  if (process.platform !== 'darwin') return;
  const { execFileSync } = require('node:child_process');
  const script = vm.runInNewContext(source + '\nMETRICS', { View: class {} });
  const token = `test-${process.pid}-${Date.now()}`;
  const port = String(49152 + Math.floor(Math.random() * 16000));
  const directory = `/tmp/nook-macmon-${token}`;
  const call = action => execFileSync('/bin/sh', ['-c', script, 'test', token, port, action],
    { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 5000 });
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    assert.equal(call('read'), '');
    await delay(3500);
    const first = parse(call('read'));
    assert.equal(first.mac, true);
    const pid = execFileSync('pgrep', ['-f', `macmon serve --host 127.0.0.1 --port ${port}`], { encoding: 'utf8' }).trim();
    await delay(2200);
    const next = parse(call('read'));
    assert.notEqual(first.timestamp, next.timestamp);
    assert.equal(execFileSync('pgrep', ['-f', `macmon serve --host 127.0.0.1 --port ${port}`], { encoding: 'utf8' }).trim(), pid);
    console.log('Live service: 2-second samples, stable PID, Homebrew discovery passed.');
  } finally {
    call('stop');
    await delay(2500);
    assert.equal(fs.existsSync(directory), false, 'Supervisor must remove its state after close');
  }
  // Simulate abrupt client loss: no close call and no further polls.
  call('read');
  await delay(23000);
  assert.equal(fs.existsSync(directory), false, 'Expired lease must stop orphaned service');
  console.log('Explicit stop and orphan lease cleanup passed.');
}
controller().then(linuxLive).then(live).catch(error => { console.error(error); process.exitCode = 1; });
console.log('Machine metric parsing checks passed.');
