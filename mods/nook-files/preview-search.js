// Search the loaded preview, bounding the number and width of rendered rows.
export function searchPreview(text, query, limit = 200) {
  if (!query) return { results: [], total: 0 };
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  const results = []; let total = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    total++;
    if (results.length >= limit) continue;
    const start = Math.max(0, match.index - 80), end = Math.min(line.length, match.index + match[0].length + 120);
    results.push({ line: index + 1, before: (start ? "…" : "") + line.slice(start, match.index),
      match: match[0], after: line.slice(match.index + match[0].length, end) + (end < line.length ? "…" : "") });
  }
  return { results, total };
}
