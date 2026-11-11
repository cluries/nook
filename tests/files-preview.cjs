// Exercise the Files preview state machine and render branches with a minimal GPUI stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('mods/nook-files/main.js', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default class ', 'globalThis.Mod = class ');

const COLORS = {
  background: '#000', foreground: '#fff', border: '#333', input: '#444', hover: '#222',
  selected: '#555', dim: '#888', muted: '#999', raised: '#666', accent: '#0af', selection: '#036',
  ansi1: '#f00', ansi2: '#0f0', ansi3: '#ff0', ansi4: '#00f', ansi5: '#f0f', ansi6: '#0ff',
  ansi9: '#a00', ansi10: '#0a0', ansi11: '#aa0', ansi12: '#00a',
};

function harness(options = {}) {
  const calls = { exec: [], read: [], images: [], editors: [], markdowns: [], notifies: 0 };
  const tasks = [];
  const state = {
    image: options.image ?? { path: 'data/nook-files-originals/x.svg', width: 320, height: 200 },
    text: options.text ?? '<svg viewBox="0 0 320 200"><rect/></svg>',
    failImage: options.failImage ?? false,
    platform: options.platform ?? 'macos',
    storage: options.storage ?? {},
  };
  const cx = {
    spawn(fn) { tasks.push(Promise.resolve().then(() => fn(cx))); },
    notify() { calls.notifies += 1; },
    sleep: async () => {},
    timer: { every() {} },
    write_to_clipboard() {},
    stop_propagation() {},
  };
  const element = () => {
    let el;
    el = new Proxy({}, { get: (_target, method) => (...args) => {
      if (method === 'when' && args[0]) args[1](el);
      return el;
    } });
    return el;
  };
  const context = {
    View: class {}, div: element, svg: element, image: path => { calls.images.push(path); return element(); },
    h_flex: element, v_flex: element, v_resizable: element, resizable_panel: element,
    Editor: { new: state => { calls.editors.push(state); return element(); } },
    EditorState: { new: config => { calls.editorConfigs ??= []; calls.editorConfigs.push(config); return { release() {} }; } },
    TextView: { markdown: (id, value) => { calls.markdowns.push({ id, value }); return element(); } },
    InputState: { new: () => ({ on() {}, value: () => '', set_value() {} }) },
    Input: { new: () => element() },
    localStorage: {
      getItem: key => Object.hasOwn(state.storage, key) ? state.storage[key] : null,
      setItem: (key, value) => { state.storage[key] = value; },
    },
    spaces: () => [], panes: () => [], focused: () => null,
    exec: async (program, args) => {
      calls.exec.push({ program, args });
      if (program === 'python3') {
        return state.failImage
          ? { code: 1, stdout: '', stderr: 'failed' }
          : { code: 0, stdout: JSON.stringify(state.image), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    },
    readTextFile: async path => { calls.read.push(path); return state.text; },
    watchFolder: async () => {},
    theme: () => COLORS,
    settings: () => ({ font_family: 'Test', font_size: 12, dark: true }),
    window: () => ({ platform: state.platform }),
    openOverlay() {}, appHome: () => '/app', run() {}, notify() {},
    ICONS: { light: {}, fileNames: {}, folderNames: {}, fileExtensions: {}, folder: 'folder', file: 'file' },
    indexFiles() {}, findMatches() { return { results: [] }; }, searchPreview() { return { results: [], total: 0 }; },
    ignoredPaths: async () => null,
  };
  vm.runInNewContext(source, context);
  const view = new context.Mod();
  view.init({}, cx);
  view.splitHeight = 600;
  view.imageSize = { width: 400, height: 300 };
  view.context.cwd = '/repo';
  view.context.on = state.platform === 'macos' ? null : undefined;
  view.root = '/repo';
  view.on = null;
  return { view, calls, state, cx, flush: () => Promise.all(tasks.splice(0)) };
}

(async () => {
  // Markdown keeps its own mode; SVG starts in Preview.
  const defaults = harness();
  assert.equal(defaults.view.previewMode, 'code');
  assert.equal(defaults.view.svgMode, 'preview');
  assert.equal(harness({ storage: { 'svg.previewMode': 'code' } }).view.svgMode, 'code');

  // The Git branch arrives after the initial render and draws an SVG icon.
  defaults.view.branch = 'main';
  assert.doesNotThrow(() => defaults.view.render(defaults.cx));

  // A local SVG loads both the cached image and the bounded source.
  const svg = harness();
  svg.view.show('layouts/nook.svg', svg.cx);
  await svg.flush();
  assert.equal(svg.calls.exec.length, 1);
  assert.equal(svg.calls.exec[0].args[0], '/app/mods/nook-files/image-cache.py');
  assert.equal(svg.calls.exec[0].args[1], '/repo/layouts/nook.svg');
  assert.equal(svg.calls.read[0], '/repo/layouts/nook.svg');
  assert.equal(svg.view.previewImage.path, 'data/nook-files-originals/x.svg');
  assert.equal(svg.view.previewImage.width, 320);
  assert.equal(svg.view.previewImage.height, 200);
  assert(svg.view.code);
  assert.equal(svg.calls.editorConfigs.at(-1).language, 'xml');
  svg.view.render(svg.cx);
  assert.deepEqual(svg.calls.images, ['data/nook-files-originals/x.svg']);
  svg.calls.images.length = 0;
  svg.calls.editors.length = 0;
  svg.view.svgMode = 'code';
  svg.view.render(svg.cx);
  assert.equal(svg.calls.images.length, 0);
  assert.equal(svg.calls.editors.length, 1);

  // A failed SVG image falls back to its source without an image error.
  const broken = harness({ failImage: true });
  broken.view.show('broken.svg', broken.cx);
  await broken.flush();
  assert.equal(broken.view.previewImage, null);
  assert.equal(broken.view.imageUnavailable, true);
  assert.equal(broken.view.fileError, null);
  broken.calls.editors.length = 0;
  broken.view.render(broken.cx);
  assert.equal(broken.calls.editors.length, 1);

  // Remote SVGs and SVGs on other platforms keep the source preview.
  for (const options of [{}, { platform: 'windows' }]) {
    const remote = harness({ ...options, text: '<svg viewBox="0 0 8 6"/>' });
    remote.view.on = options.platform ? null : 'server';
    remote.view.show('remote.svg', remote.cx);
    await remote.flush();
    assert.equal(remote.calls.exec.length, 0);
    assert.equal(remote.calls.read.length, 1);
    assert.equal(remote.view.previewImage, null);
    assert.equal(remote.view.imageUnavailable, true);
    remote.calls.editors.length = 0;
    remote.view.render(remote.cx);
    assert.equal(remote.calls.editors.length, 1);
    assert.equal(remote.view.svgMode, 'preview');
  }

  // Raster images still use the image-only path locally and report the same limits remotely.
  const png = harness({ image: { path: 'data/nook-files-originals/x.png', width: 10, height: 8 }, text: 'not read' });
  png.view.show('picture.png', png.cx);
  await png.flush();
  assert.equal(png.calls.exec.length, 1);
  assert.equal(png.calls.read.length, 0);
  png.view.render(png.cx);
  assert.deepEqual(png.calls.images, ['data/nook-files-originals/x.png']);

  const remotePng = harness({ text: 'not read' });
  remotePng.view.on = 'server';
  remotePng.view.show('picture.png', remotePng.cx);
  assert.equal(remotePng.calls.exec.length, 0);
  assert.equal(remotePng.calls.read.length, 0);
  assert.equal(remotePng.view.fileError, 'Image preview is unavailable for remote files');

  const windowsPng = harness({ platform: 'windows', text: 'not read' });
  windowsPng.view.show('picture.png', windowsPng.cx);
  assert.equal(windowsPng.view.fileError, 'Image preview is available on macOS only');

  console.log('Files preview: SVG image/source branches, fallback, modes, remote and raster checks passed');
})();
