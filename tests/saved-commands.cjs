const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let entries = [], focusCount = 0;
const runs = [], closed = [];
const cx = { focus_handle: () => ({ focus() { focusCount++; } }), notify() {}, stop_propagation() {}, spawn() {} };
const input = () => ({ text: '', value() { return this.text; }, set_value(v) { this.text = v; }, focus() {} });
const context = { View: class {}, InputState: { new: input }, TextareaState: { new: input },
  shared: () => entries, setShared: (_key, value) => { entries = value; }, props: () => ({ space: 'space', cwd: '/work', overlay: 'dialog' }),
  spaces: () => [{ id: 'space' }], run: (...args) => runs.push(args), closeOverlay: id => closed.push(id) };
vm.runInNewContext(fs.readFileSync('mods/nook-commands/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class '), context);
const view = new context.Mod(); view.init({}, cx);
const key = keystroke => view.keyDown({ keystroke }, cx);
key('enter'); key('up'); key('down'); assert.equal(runs.length, 0);
entries = Array.from({ length: 20 }, (_, i) => ({ name: `Command ${i}`, command: `echo ${i}` }));
key('up'); assert.equal(view.selected, 19);
key('down'); assert.equal(view.selected, 0);
key('down'); key('enter'); assert.equal(runs.length, 1);
assert.equal(runs[0][1].name, 'Command 1'); assert.equal(runs[0][1].argv[2], 'echo 1');
assert.equal(runs[0][1].folder, '/work'); assert.equal(closed[0], 'dialog');
for (const field of ['editing', 'deleting', 'starting']) {
  const previous = view[field]; view[field] = field === 'starting' ? true : 0;
  key('enter'); key('down'); assert.equal(runs.length, 1); assert.equal(view.selected, 1);
  view[field] = previous;
}
key('cmd-enter'); assert.equal(runs.length, 1);
for (let i = 1; i <= 9; i++) {
  key(String(i));
  assert.equal(runs.at(-1)[1].argv[2], `echo ${i - 1}`);
  assert.equal(view.selected, i - 1);
}
key('cmd-1'); key('0'); assert.equal(runs.length, 10);
for (const field of ['editing', 'deleting', 'starting']) {
  const previous = view[field]; view[field] = field === 'starting' ? true : 0;
  key('1'); assert.equal(runs.length, 10);
  view[field] = previous;
}
view.edit(-1, cx); view.name.set_value('New'); view.command.set_value('echo new'); view.save(cx);
assert.equal(view.selected, 20); assert.equal(focusCount, 2);
entries = entries.slice(0, 1); key('down'); assert.equal(view.selected, 0);
for (let i = 2; i <= 9; i++) key(String(i));
assert.equal(runs.length, 10);
view.selectRow(0, { click_count: 1 }, cx); assert.equal(runs.length, 10);
view.selectRow(0, { click_count: 2 }, cx); assert.equal(runs.length, 11);
assert.equal(runs[10][1].argv[2], 'echo 0');
for (const field of ['editing', 'deleting', 'starting']) {
  const previous = view[field]; view[field] = field === 'starting' ? true : 0;
  view.selectRow(0, { click_count: 2 }, cx); assert.equal(runs.length, 11);
  view[field] = previous;
}
entries = [{ name: 'A', command: 'a', background: true }, { name: 'B', command: 'b', priority: -1 }, { name: 'C', command: 'c' }];
assert.equal(view.entries().map(e => e.name).join(''), 'BAC');
key('1'); assert.equal(runs.at(-1)[1].argv[2], 'b');
view.edit(1, cx); assert.equal(view.priority.value(), '0');
view.priority.set_value('-2'); view.save(cx);
assert.equal(view.entries().map(e => e.name).join(''), 'ABC');
assert.equal(view.selected, 0); assert.equal(entries[0].background, true);
view.edit(0, cx); view.priority.set_value('bad'); view.save(cx);
assert.equal(view.editing, 0); assert.equal(entries[0].priority, -2);
view.priority.set_value('0'); view.save(cx);
assert.equal(view.entries().map(e => e.name).join(''), 'BAC');
view.edit(-1, cx); view.name.set_value('D'); view.command.set_value('d'); view.priority.set_value('0'); view.save(cx);
assert.equal(view.entries().map(e => e.name).join(''), 'BACD'); assert.equal(view.selected, 3);
key('3'); assert.equal(runs.at(-1)[1].argv[2], 'c');
console.log('Saved command keyboard checks passed.');
