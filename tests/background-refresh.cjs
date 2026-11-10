// Exercise delayed host responses: polling must not duplicate active work,
// while actual filesystem invalidations must still schedule a follow-up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(mod, host = {}) {
  const context = {
    View: class {}, spaces: () => [], machines: () => [], panes: () => [],
    localStorage: { getItem: () => null }, ...host,
  };
  const source = fs.readFileSync(`mods/${mod}/main.js`, 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ')
    .replace('export default class ', 'globalThis.Mod = class ');
  vm.runInNewContext(source, context);
  const view = new context.Mod();
  view.init({}, { spawn() {}, timer: { every() {} } });
  return view;
}

async function main() {
  const spaces = ['slow', 'waiting'].map(id => ({ id, folder: `/${id}`, tabs: [] }));
  const view = load('nook-spaces', { spaces: () => spaces, window: () => ({ active: false }) });
  const slow = JSON.stringify([null, '/slow']), waiting = JSON.stringify([null, '/waiting']);
  const jobs = [], checks = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cx = { spawn(fn) { jobs.push(fn(cx)); }, notify() {} };
  view.orderingDue = () => false;
  view.check = async key => {
    checks.push(key);
    if (checks.length === 1) await gate;
    view.git[key] = null;
  };
  view.checkNew(cx);
  for (let i = 0; i < 20; i++) view.checkNew(cx);
  assert.deepEqual(checks, [slow]);
  assert.equal(view.pending.size, 0, 'polling must not queue active or waiting batch entries');
  // A real change during the query still requires one subsequent check.
  view.refreshGit([slow], cx);
  view.refreshGit([slow], cx);
  release();
  await Promise.all(jobs);
  assert.deepEqual(checks, [slow, waiting, slow]);
  assert.equal(view.checking.size, 0);
  assert.equal(view.refreshing, false);
  // Command completion remains an invalidation even if its first query is
  // active; deduplication applies only to the missing-cache polling case.
  const commandView = load('nook-spaces', { window: () => ({ active: false }) });
  commandView.checking.add(slow);
  const commandSpaces = [{ id: 'slow', folder: '/slow', tabs: [{ id: 'tab' }] }];
  const pane = { pane: 'pane', tab: 'tab', terminal: 't1', program: { shell: true }, status: 'working' };
  assert.equal(commandView.due(Date.now(), commandSpaces, [pane]).size, 0);
  pane.status = 'idle';
  assert(commandView.due(Date.now(), commandSpaces, [pane]).has(slow));

  let calls = 0, notifications = 0, reply;
  const machine = load('nook-spaces', { hc: () => {
    calls++;
    return new Promise(resolve => { reply = resolve; });
  } });
  machine.machinesBusy = false; // init's task was intentionally not run by the harness.
  const machineJobs = [];
  const machineCx = { spawn(fn) { machineJobs.push(fn(machineCx)); }, notify() { notifications++; } };
  const poll = async stdout => {
    machine.refreshMachines(machineCx);
    machine.refreshMachines(machineCx);
    reply({ code: 0, stdout });
    await Promise.all(machineJobs);
  };
  await poll('{"machines":[]}');
  assert.equal(calls, 1, 'overlapping machine polls must coalesce');
  assert.equal(notifications, 0, 'unchanged machine list needs no redraw');
  await poll('{"machines":[{"name":"remote","state":"connected"}]}');
  assert.equal(notifications, 1);
  await poll('{"machines":[{"name":"remote","state":"connected"}]}');
  assert.equal(notifications, 1);
  await poll('{"machines":[{"name":"remote","state":"unreachable"}]}');
  assert.equal(notifications, 2, 'connection changes must redraw');
  await poll('invalid JSON');
  assert.equal(machine.machinesBusy, false, 'failed poll must allow recovery');
  await poll('{"machines":[]}');
  assert.equal(notifications, 3, 'removed machines must redraw');

  let tick, active = true, width = 268, redraws = 0;
  const footer = load('nook-footer', {
    window: () => ({ active }), layout: () => ({ id: 'sidebar', size: { px: width } }),
  });
  footer.init({}, { timer: { every(ms, fn) { assert.equal(ms, 1000); tick = fn; } } });
  const clockCx = { notify() { redraws++; } };
  tick(clockCx);
  width = 159; tick(clockCx);
  width = 268; active = false; tick(clockCx);
  active = true; tick(clockCx);
  assert.equal(redraws, 2, 'only an active window with a visible clock needs timer redraws');
  console.log('Background refresh checks passed (slow Git, watcher follow-up, machine coalescing, unchanged data, recovery, clock visibility).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
