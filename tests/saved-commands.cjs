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
view.edit(-1, cx); view.name.set_value('New'); view.command.set_value('echo new'); view.save(cx);
assert.equal(view.selected, 20); assert.equal(focusCount, 2);
entries = entries.slice(0, 1); key('down'); assert.equal(view.selected, 0);
console.log('Saved command keyboard checks passed.');
