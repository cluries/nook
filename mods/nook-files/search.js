// Pure matching and bounded, reusable directory indexing (no host dependencies).
export function matcher(query) {
  const q = query.trim().toLowerCase();
  if (!/[?*]/.test(q)) return path => path.toLowerCase().includes(q);
  let pattern = '';
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === '*' && q[i + 1] === '*') {
      i++;
      if (q[i + 1] === '/') { i++; pattern += '(?:.*/)?'; }
      else pattern += '.*';
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else pattern += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  // Patterns without a slash match a basename at any depth; paths are root-relative.
  const re = new RegExp((q.includes('/') ? '^' : '(?:^|/)') + pattern + '$');
  return path => re.test(path.toLowerCase());
}

const SKIP = new Set(['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']);
export async function indexFiles(read, current) {
  const queue = [{ path: '', depth: 0 }], entries = [];
  let head = 0, count = 0, limited = false, failures = 0;
  while (head < queue.length && count < 5000 && current()) {
    const batch = queue.slice(head, head + 4); head += batch.length;
    const listings = await Promise.all(batch.map(async folder => {
      try { return await read(folder.path); } catch { failures++; return []; }
    }));
    if (!current()) return null;
    for (let i = 0; i < batch.length; i++) {
      const folder = batch[i], listing = listings[i];
      if (listing.length > 500) limited = true;
      for (const entry of listing.slice(0, 500)) {
        if (count >= 5000) { limited = true; break; }
        count++;
        const path = folder.path ? `${folder.path}/${entry.name}` : entry.name;
        entries.push({ ...entry, path });
        if (entry.dir && !SKIP.has(entry.name)) {
          if (folder.depth + 1 < 12) queue.push({ path, depth: folder.depth + 1 });
          else limited = true;
        }
      }
    }
  }
  return { entries, limited: limited || head < queue.length, failures };
}

export function findMatches(index, query) {
  const matches = matcher(query), results = [];
  let limited = index.limited;
  for (const entry of index.entries) if (matches(entry.path)) {
    if (results.length === 200) { limited = true; break; }
    results.push(entry);
  }
  return { results, limited, error: index.failures ? `Could not read ${index.failures} folder(s)` : null };
}
