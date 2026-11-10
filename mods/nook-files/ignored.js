// Check visible paths in bounded batches; Git accounts for nested rules and tracked files.
export async function ignoredPaths(paths, run, batchSize = 100) {
  const ignored = new Set();
  for (let i = 0; i < paths.length; i += batchSize) {
    const result = await run(paths.slice(i, i + batchSize));
    if (!result || (result.code !== 0 && result.code !== 1)) return null;
    if (result.code === 0) for (const path of result.stdout.split("\0")) if (path) ignored.add(path);
  }
  return ignored;
}
