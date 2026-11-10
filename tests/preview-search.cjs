const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const source = fs.readFileSync('mods/nook-files/preview-search.js');
  const { searchPreview } = await import('data:text/javascript;base64,' + source.toString('base64'));
  const found = searchPreview('a.b\nfoo A.B bar\naxb', 'a.b');
  assert.equal(found.total, 2);
  assert.deepEqual(found.results[1], { line: 2, before: 'foo ', match: 'A.B', after: ' bar' });
  assert.equal(searchPreview('abc', '').total, 0);
  assert.equal(searchPreview('abc', '[').total, 0);
  assert.equal(searchPreview('yes\n'.repeat(205), 'yes').results.length, 200);
  assert.equal(searchPreview('yes\n'.repeat(205), 'yes').total, 205);
  const long = searchPreview('x'.repeat(300) + 'target' + 'y'.repeat(300), 'target').results[0];
  assert(long.before.startsWith('…') && long.after.endsWith('…'));
  console.log('Preview search: literal matching, line numbers, limits and snippets passed');
})();
