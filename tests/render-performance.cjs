// Exercise the actual render methods with a minimal GPUI builder, without Herdr.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(mod, data) {
  const calls = {}, labels = [], state = {};
  const element = () => {
    let el;
    el = new Proxy({}, { get: (_, method) => (...args) => {
      if (method === 'when' && args[0]) args[1](el);
      if (method === 'child' && typeof args[0] === 'string') labels.push(args[0]);
      return el;
    }});
    return el;
  };
  const context = {
    View: class {}, div: element, svg: element, image: element,
    h_flex: element, v_flex: element,
    localStorage: { getItem: () => null, setItem() {} },
    theme: () => ({}), layout: () => null, window: () => ({}), settings: () => ({ zoom: 1 }),
    shared: key => state[key], setShared: (key, value) => { state[key] = value; },
    run() {}, openOverlay() {},
  };
  for (const name of ['spaces', 'panes', 'agents', 'machines']) {
    context[name] = () => { calls[name] = (calls[name] ?? 0) + 1; return data[name] ?? []; };
  }
  const source = fs.readFileSync(`mods/${mod}/main.js`, 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ')
    .replace('export default class ', 'globalThis.Mod = class ');
  vm.runInNewContext(source, context);
  const view = new context.Mod();
  view.init({}, { spawn() {}, timer: { every() {} } });
  for (const key of Object.keys(calls)) delete calls[key];
  return { view, calls, labels, state };
}

const tabs = [
  { id: 'a', name: '1' }, { id: 'b', name: '2' },
  { id: 'c', name: 'Manual', named: true }, { id: 'd', name: '4' },
];
const data = {
  spaces: [{ id: 's', active: true, tabs }],
  panes: [
    { tab: 'a', terminal: '1', cwd: '/shell', program: { shell: true } },
    { tab: 'a', terminal: '2', program: { name: 'build' } },
    { tab: 'a', terminal: '3', title: ' First agent ', program: { agent: true } },
    { tab: 'a', terminal: '4', title: 'Second agent', program: { agent: true } },
    { tab: 'b', terminal: '5', cwd: 'C:\\work\\folder\\', program: { shell: true } },
    { tab: 'c', terminal: '6', title: 'Ignored', program: { agent: true } },
    { tab: 'd', title: 'Mod pane', program: { agent: true } },
  ],
};
const tabRun = load('nook-tabs', data);
tabRun.view.render();
for (const label of ['First agent', 'folder', 'Manual', '4']) assert(tabRun.labels.includes(label), label);
assert(!tabRun.labels.includes('Second agent'));
assert.equal(tabRun.calls.panes, 1);
// A later render must see changed live data rather than a persistent cache.
data.panes[2].title = 'Updated agent';
tabRun.view.render();
assert(tabRun.labels.includes('Updated agent'));

for (const size of [1, 100]) {
  const spaces = Array.from({ length: size }, (_, i) => ({
    id: `s${i}`, name: `Space ${i}`, tabs: [{ id: `t${i}` }], folder: `/repo${i}`, status: 'working',
  }));
  const run = load('nook-spaces', {
    spaces, panes: spaces.map((s, i) => ({ tab: `t${i}`, cwd: s.folder, terminal: `p${i}` })),
    agents: spaces.flatMap(s => [{ space: s.id }, { space: s.id }]),
  });
  run.view.render();
  assert.equal(run.calls.panes, 1);
  assert.equal(run.calls.agents, 1);
  assert.equal(run.calls.machines, 1);
  assert(run.labels.includes('Working 2'));
  assert.equal(Object.keys(run.state['space.colors']).length, size);
  const colors = Object.values(run.state['space.colors']);
  const counts = [...new Set(colors)].map(c => colors.filter(v => v === c).length);
  assert(Math.max(...counts) - Math.min(...counts) <= 1);
}
console.log('Render regression checks passed (tab priority, live updates, 1/100 spaces, native getter counts, balanced colors).');

// Count actual model-field reads: native getter counts alone hide repeated
// JavaScript scans of the same snapshot. Include nontrivial pane ordering.
for (const size of [1, 100, 1000]) {
  let tabReads = 0;
  const spaces = Array.from({ length: size }, (_, i) => ({
    id: `s${i}`, name: `Space ${i}`, tabs: [{ id: `t${i}` }, { id: `extra${i}` }], folder: `/fallback${i}`,
  }));
  const panes = spaces.map((s, i) => ({
    get tab() { tabReads++; return `extra${i}`; }, cwd: `/live${i}`, terminal: `p${i}`,
  }));
  panes.push({ tab: 't0', cwd: '/later-pane', terminal: 'later' });
  const data = { spaces, panes };
  const run = load('nook-spaces', data);
  for (let i = 0; i < size; i++) run.view.git[JSON.stringify([null, `/live${i}`])] = null;
  run.view.render();
  assert.equal(run.calls.spaces, 1);
  assert(tabReads <= size * 2, `render scanned ${tabReads} pane tabs for ${size} Spaces`);
  assert(run.labels.some(label => label.startsWith('/live0')), 'pane order must take priority over tab order');
  tabReads = 0;
  run.view.due(Date.now(), spaces, panes);
  assert(tabReads <= size * 4, `Git polling scanned ${tabReads} pane tabs for ${size} Spaces`);
  assert.equal(JSON.parse(run.view.at.s0)[1], '/live0');
  panes[0].cwd = '/changed';
  run.view.git[JSON.stringify([null, '/changed'])] = null;
  run.labels.length = 0;
  run.view.render();
  assert(run.labels.some(label => label.startsWith('/changed')), 'render must see folder changes');
  run.view.due(Date.now(), spaces, panes);
  assert.equal(JSON.parse(run.view.at.s0)[1], '/changed');
}

// Worktrees stay under the first main checkout, in input order. Orphans stay
// independent, and pin partitions only retain tree markers beside a parent.
{
  const spaces = ['child2', 'main', 'child1', 'duplicate', 'orphan', 'remote'].map(id => ({
    id, name: id, folder: `/${id}`, tabs: [], machine: id === 'remote' ? 'server' : null,
  }));
  const run = load('nook-spaces', { spaces });
  for (const s of spaces) run.view.git[JSON.stringify([s.machine, s.folder])] = {
    repo: s.id === 'orphan' ? 'missing' : s.id === 'remote' ? 'remote-repo' : 'repo',
    linked: ['child1', 'child2', 'orphan'].includes(s.id),
  };
  const rows = [];
  run.view.row = r => { rows.push(r); return {}; };
  run.state['nook.spaces.pinned'] = { child1: true };
  run.view.render();
  assert.deepEqual(rows.map(r => r.w.id), ['child1', 'main', 'child2', 'duplicate', 'orphan', 'remote']);
  assert.equal(rows.find(r => r.w.id === 'child1').tree, null);
  assert.equal(rows.find(r => r.w.id === 'child2').tree, '├─');
  assert.equal(rows.find(r => r.w.id === 'orphan').tree, null);
  run.state['nook.spaces.pinned'].main = true;
  run.state['nook.spaces.pinned'].duplicate = true;
  rows.length = 0;
  run.view.render();
  assert.equal(rows.find(r => r.w.id === 'child1').tree, '└─');
  assert.equal(rows.find(r => r.w.id === 'child2').tree, null);
}
console.log('Index regression checks passed (1/100/1000 spaces, linear pane reads, live folders, worktrees, duplicate checkouts, pins, remote groups).');

{
  const spaces = [
    { id: 'local', name: 'local', folder: '/fallback', tabs: [{ id: 'empty' }] },
    { id: 'remote', name: 'remote', machine: 'server', folder: '/fallback', tabs: [] },
  ];
  const r = load('nook-spaces', { spaces, panes: [{ tab: 'empty', cwd: '' }, { tab: 'unknown', cwd: '/unrelated' }] });
  r.view.due(Date.now(), spaces, []);
  assert.equal(r.view.at.local, JSON.stringify([null, '/fallback']));
  assert.equal(r.view.at.remote, JSON.stringify(['server', '/fallback']));
}

{
  let reads = 0;
  const spaces = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: `Space ${i}`, folder: `/repo${i}`, tabs: [] }));
  const r = load('nook-spaces', { spaces });
  for (const [i, space] of spaces.entries()) r.view.git[JSON.stringify([null, space.folder])] = {
    get linked() { reads++; return i % 2 === 1; },
    repo: `repo${Math.floor(i / 2)}`,
  };
  r.view.render();
  assert(reads < spaces.length * 10, `worktree grouping read linked ${reads} times`);
}
console.log('Folder fallback, machine isolation, and linear worktree grouping checks passed.');
