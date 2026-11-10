const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
(async () => {
  const source = fs.readFileSync('mods/nook-files/ignored.js');
  const { ignoredPaths } = await import('data:text/javascript;base64,' + source.toString('base64'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-ignore-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    assert.equal(git('init', '-q').status, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\ncache/\n');
    fs.writeFileSync(path.join(dir, 'tracked.log'), 'tracked');
    assert.equal(git('add', '-f', 'tracked.log').status, 0);
    fs.writeFileSync(path.join(dir, 'new log.log'), 'ignored');
    fs.writeFileSync(path.join(dir, 'line\nbreak.log'), 'ignored');
    fs.mkdirSync(path.join(dir, 'cache'));
    const paths = ['new log.log', 'tracked.log', 'cache', 'line\nbreak.log', 'ordinary'];
    const found = await ignoredPaths(paths, async batch => {
      // Feed NUL-delimited paths just as the Herdr shell invocation does.
      const checked = spawnSync('git', ['--no-optional-locks', 'check-ignore', '--stdin', '-z'], { cwd: dir, encoding: 'utf8', input: batch.join('\0') + '\0' });
      return { code: checked.status, stdout: checked.stdout };
    }, 2);
    assert.deepEqual([...found], ['new log.log', 'cache', 'line\nbreak.log']);
    assert.equal(await ignoredPaths(['x'], async () => ({ code: 128, stdout: '' })), null);
    console.log('Git ignore: tracked files, directories, unusual names and batches passed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
