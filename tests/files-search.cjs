const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { matcher, indexFiles, findMatches } = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync('mods/nook-files/search.js')).toString('base64'));
  for (const [q, path, expected] of [
    ['MAIN', 'src/main.js', true], ['*.js', 'src/main.js', true],
    ['*.js', 'src/main.jsx', false], ['src/*.js', 'src/deep/main.js', false],
    ['src/**/*.js', 'src/main.js', true], ['src/**/*.js', 'src/deep/main.js', true],
    ['file?.txt', 'nested/file1.txt', true], ['file?.txt', 'file12.txt', false],
    ['*.a+b', 'x.a+b', true], ['*.a+b', 'x.aaab', false],
    ['src/*.js', 'other/src/main.js', false], ['**/main.js', 'main.js', true],
  ]) assert.equal(matcher(q)(path), expected, `${q}: ${path}`);
  let reads = 0, active = 0, peak = 0;
  const read = async path => {
    reads++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    if (!path) return [...Array.from({ length: 10 }, (_, i) => ({ name: `dir${i}`, dir: true })), { name: 'node_modules', dir: true }];
    assert.notEqual(path, 'node_modules');
    if (path === 'dir9') throw Error('unreadable');
    return [{ name: 'main.js', dir: false }];
  };
  const index = await indexFiles(read, () => true);
  assert.equal(reads, 11); assert.equal(peak, 4); assert.equal(index.failures, 1);
  assert.equal(findMatches(index, '*.js').results.length, 9);
  findMatches(index, 'dir1'); findMatches(index, '**/*.js');
  assert.equal(reads, 11, 'query changes reuse the index without directory reads');
  const capped = await indexFiles(async () => Array.from({ length: 501 }, (_, i) => ({ name: `f${i}`, dir: false })), () => true);
  assert.equal(capped.entries.length, 500); assert(capped.limited);
  assert.equal(findMatches(capped, '*').results.length, 200);
  assert(findMatches(capped, '*').limited);
  let valid = true;
  assert.equal(await indexFiles(async () => { valid = false; return []; }, () => valid), null);
  console.log('Files search: wildcard matching, index reuse, concurrency, limits, errors and cancellation passed');
})();
