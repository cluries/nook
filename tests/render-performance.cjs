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
