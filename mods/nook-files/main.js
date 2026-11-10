// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, v_resizable, resizable_panel, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, openOverlay, appHome } from "herdr";
import ICONS from "./icons.js";
import { indexFiles, findMatches } from "./search.js";
import { searchPreview } from "./preview-search.js";
import { ignoredPaths } from "./ignored.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
function fileIcon(path, dir, open, dark) {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1];
  const table = dir ? "folderNames" : "fileNames";
  const lookup = (key, kind = table) => (dark ? undefined : ICONS.light[kind][key]) ?? ICONS[kind][key];
  const find = key => lookup(key) ?? (dir ? lookup(key.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "")) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    id ??= find(name) ?? ICONS.folder;
    if (open) id = id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
  } else {
    id ??= lookup(name);
    for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) id = lookup(name.slice(dot + 1), "fileExtensions");
    id ??= ICONS.file;
  }
  return `mods/nook-files/icons/${id}.svg`;
}
// image() loads application assets. Keep the original bytes and format;
// sips only reads dimensions, and the layout handles visual scaling.
async function originalImage(source) {
  const result = await exec("python3", [`${appHome()}/mods/nook-files/image-cache.py`, source, appHome()]);
  if (result.code !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.previewMode = localStorage.getItem("markdown.previewMode") === "preview" ? "preview" : "code";
    const savedRatio = Number(localStorage.getItem("split.ratio"));
    this.splitRatio = savedRatio > 0 && savedRatio < 1 ? savedRatio : 0.5;
    this.splitHeight = 0;
    this.imageSize = { width: 0, height: 0 };
    this.saved = new Map();
    this.query = ""; this.searchSeq = 0; this.searchResults = []; this.searching = false;
    this.input = InputState.new({ placeholder: "Search files (*, ?, **)…" });
    this.input.on("change", (_e, cx) => this.search(this.input.value(), cx));
    this.previewSearch = InputState.new({ placeholder: "Search preview…" });
    this.previewQuery = ""; this.previewResults = { results: [], total: 0 };
    this.previewSearch.on("change", (_e, cx) => {
      this.previewQuery = this.previewSearch.value();
      this.previewResults = searchPreview(this.previewText ?? "", this.previewQuery);
      cx.notify();
    });
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {}; this.ignored = new Set();
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const visible = entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    this.entries.set(path, visible);
    const paths = visible.map(entry => path ? `${path}/${entry.name}` : entry.name);
    const ignored = await ignoredPaths(paths, batch => exec("sh", ["-c", 'printf "%s\\0" "$@" | git --no-optional-locks check-ignore --stdin -z', "nook-ignore", ...batch], { cwd: root, on }).catch(() => null));
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    if (ignored) for (const item of paths) { this.ignored.delete(item); if (ignored.has(item)) this.ignored.add(item); }
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.ignored = new Set(); this.show(null, cx); this.watched = null; this.error = null; this.limited = false;
      this.searchIndex = null; this.branch = null; this.gitError = false; this.searchSeq++; this.searchResults = []; this.searching = false;
      if (this.query) { this.query = ""; this.input.set_value(""); }
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.searchIndex = null; // Expire on folder watch, context switch, or 10-second refresh.
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {}; let branch = null, gitError = false;
        if (top?.code === 0) {
          const branchResult = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd, on }).catch(() => null);
          branch = branchResult?.code === 0 ? branchResult.stdout.trim() : "detached HEAD";
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          gitError = status?.code !== 0;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            const mark = xy === "??" ? "?" : /U/.test(xy) || xy === "AA" || xy === "DD" ? "U" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
            const full = `${top.stdout.trim()}/${entry.slice(3)}`;
            marks[full] = mark;
            let parent = full.slice(0, full.lastIndexOf("/"));
            while (parent.startsWith(`${cwd}/`)) { marks[parent] ??= mark; parent = parent.slice(0, parent.lastIndexOf("/")); }
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.branch = branch; this.gitError = gitError; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  search(query, cx) {
    this.query = query; const seq = ++this.searchSeq, context = this.context, q = query.trim().toLowerCase();
    this.searchResults = []; this.searchError = null; this.searchLimited = false; this.searching = Boolean(q && context?.cwd);
    if (!this.searching) { cx.notify(); return; }
    cx.spawn(async cx => {
      try {
        await cx.sleep(250);
        if (seq !== this.searchSeq || !this.current(context)) return;
        if (!this.searchIndex) this.searchIndex = indexFiles(
          path => directory(path ? `${context.cwd}/${path}` : context.cwd, context.on),
          () => this.current(context));
        const index = await this.searchIndex;
        if (!index || seq !== this.searchSeq || !this.current(context)) return;
        const found = findMatches(index, q);
        this.searchResults = found.results; this.searchLimited = found.limited; this.searchError = found.error;
      } catch (e) {
        if (seq === this.searchSeq && this.current(context)) { this.searchError = String(e); this.searchIndex = null; }
      } finally { if (seq === this.searchSeq) { this.searching = false; cx.notify(); } }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null; this.previewText = null; this.previewImage = null;
    this.previewQuery = ""; this.previewResults = { results: [], total: 0 }; this.previewSearch.set_value("");
    const request = this.previewRequest = (this.previewRequest ?? 0) + 1;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    if (IMAGE.test(path)) {
      if (on) this.fileError = "Image preview is unavailable for remote files";
      else if (window()?.platform !== "macos") this.fileError = "Image preview is available on macOS only";
      else cx.spawn(async cx => {
        try {
          const original = await originalImage(`${root}/${path}`);
          if (this.previewRequest !== request || !this.current(context)) return;
          this.previewImage = original;
        } catch { if (this.previewRequest === request && this.current(context)) this.fileError = "Cannot preview this image (unreadable or unsupported)"; }
        finally { cx.notify(); }
      });
      return;
    }
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.previewRequest !== request || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.previewText = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: this.previewText,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.previewRequest === request && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  row(entry, path, depth, t, search = false) {
      const open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const label = search ? path : entry.name, ignored = this.ignored.has(path) && !mark;
      const dark = settings().dark;
      const markColor = mark === "?" ? (dark ? t.ansi12 : t.ansi4)
        : mark === "A" ? (dark ? t.ansi10 : t.ansi2)
        : mark === "D" || mark === "U" ? (dark ? t.ansi9 : t.ansi1) : (dark ? t.ansi11 : t.ansi3);
      const markLabel = { "?": "Untracked", A: "Added", M: "Modified", D: "Deleted", U: "Conflict" }[mark];
      return h_flex().id(`file-${path}`).h(26).flex_none().pl(6 + depth * 16).pr(6).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .when(path === this.file && !entry.dir, el => el.bg(t.selected))
        .on_click((_e, cx) => {
          if (entry.dir && search) {
            this.input.set_value(""); this.search("", cx);
            let parent = "";
            for (const part of path.split("/")) { parent = parent ? `${parent}/${part}` : part; if (!this.folders.has(parent)) this.toggle(parent, cx); }
          }
          else if (entry.dir) this.toggle(path, cx);
          else { this.show(path, cx); cx.notify(); }
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "nook-files-menu", kind: "popup", width: 220, height: 143, props: { root: this.root, path, machine: this.on, terminal: focused()?.terminal ?? null } });
        })
        .child(entry.dir ? svg(`mods/nook-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(image(fileIcon(path, entry.dir, open, dark)).size(16).flex_none())
        .child(div().min_w(0).truncate().when(ignored, el => el.text_color(t.dim).tooltip("Ignored by Git"))
          .when(Boolean(mark), el => el.text_color(markColor)).child(label))
        .when(Boolean(mark), el => el.child(div().size(7).flex_none().rounded(7)
          .when(mark === "?", dot => dot.border_1().border_color(markColor))
          .when(mark !== "?", dot => dot.bg(markColor))
          .tooltip(entry.dir ? `Contains changes: ${markLabel}` : markLabel)));
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      out.push(this.row(entry, path, depth, t));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), markdown = /\.(md|markdown|mdown|mkd)$/i.test(this.file ?? "");
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(v_flex().id("files-split-frame").w_full().flex_1().min_h(0)
        .on_size_change((size, cx) => { if (this.splitHeight !== size.height) { this.splitHeight = size.height; cx.notify(); } })
        .when(this.splitHeight > 0, el => el.child(v_resizable("nook-files-split").size_full()
        .on_resize(sizes => {
          const total = sizes[0] + sizes[1];
          if (total > 0) { this.splitRatio = sizes[0] / total; localStorage.setItem("split.ratio", String(this.splitRatio)); }
        })
        .child(resizable_panel().size(Math.max(100, this.splitHeight * this.splitRatio)).size_range(100).child(v_flex().size_full().min_h(0)
          .child(h_flex().h(34).flex_none().px(10).gap(12).items_center().border_b(1).border_color(t.border)
            .child(h_flex().w(140).h(24).flex_none().px(6).gap(4).items_center().rounded(5).border_1().border_color(t.input)
              .child(Input.new(this.input).flex_1().min_w(0).text_size(11).text_color(t.foreground))
              .when(Boolean(this.query), el => el.child(div().id("files-search-clear").flex_none().text_size(15).text_color(t.muted).cursor_pointer()
                .tooltip("Clear search")
                .on_click((_e, cx) => { this.input.set_value(""); this.search("", cx); }).child("×"))))
            .when(Boolean(this.branch), el => el.child(h_flex().flex_1().min_w(0).pr(4).gap(4).items_center().text_color(t.muted)
              .tooltip(`${this.branch}${this.gitError ? " · status unavailable" : ""}`)
              .child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none())
              .child(div().min_w(0).truncate().text_size(11).child(`${this.branch}${this.gitError ? " · status unavailable" : ""}`)))))
          .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(4).children(this.query.trim() ? this.searchResults.map(entry => this.row(entry, entry.path, 0, t, true)) : this.rows("", 0, [], t))
          .when(Boolean(this.error) || (this.query.trim() ? !this.searchResults.length : !this.entries.get("")?.length), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.query.trim() ? (this.searching ? "Searching…" : "No matches") : this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
          .when(Boolean(this.query.trim()) && (this.searching || this.searchLimited || this.searchError), el => el.child(div().p(8).text_size(11).text_color(t.dim).child(this.searching ? "Searching…" : this.searchError || "Search limited; refine your query")))
          .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
          )
        .child(resizable_panel().size_range(100).child(v_flex().size_full().min_h(0).overflow_hidden()
          .child(h_flex().h(34).flex_none().px(10).gap(12).items_center().border_b(1).border_color(t.border)
            .when(Boolean(this.code), el => el.child(h_flex().w(140).h(24).flex_none().px(6).gap(4).items_center().rounded(5).border_1().border_color(t.input)
              .child(Input.new(this.previewSearch).flex_1().min_w(0).text_size(11).text_color(t.foreground))
              .when(Boolean(this.previewQuery), box => box.child(div().id("preview-search-clear").flex_none().cursor_pointer().text_size(15).text_color(t.muted).tooltip("Clear preview search")
                .on_click((_e, cx) => { this.previewSearch.set_value(""); this.previewQuery = ""; this.previewResults = { results: [], total: 0 }; cx.notify(); }).child("×")))))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(this.file ?? "Preview"))
            .when(markdown, el => el.child(h_flex().h_full().flex_none().gap(14)
              .children(["code", "preview"].map(mode => v_flex().id(`files-mode-${mode}`).h_full().cursor_pointer().justify_end()
                .text_size(11).text_color(this.previewMode === mode ? t.foreground : t.dim)
                .hover(s => s.text_color(t.foreground))
                .on_click((_e, cx) => { this.previewMode = mode; localStorage.setItem("markdown.previewMode", mode); cx.notify(); })
                .child(h_flex().flex_1().items_center().child(mode === "code" ? "Code" : "Preview"))
                .child(div().h(2).bg(this.previewMode === mode ? t.accent : t.background)))))))
          .child(this.code && this.previewQuery ? v_flex().id("preview-search-results").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(4)
            .child(div().text_size(11).text_color(t.muted).child(`${this.previewResults.total} matching lines${this.previewResults.total > 200 ? " · first 200 shown" : ""}`))
            .when(!this.previewResults.total, el => el.child(div().p(4).text_size(12).text_color(t.muted).child("No matching lines")))
            .children(this.previewResults.results.map(result => h_flex().gap(8).items_center().text_size(12)
              .child(div().w(44).flex_none().text_right().text_color(t.dim).child(String(result.line)))
              .child(h_flex().min_w(0).overflow_hidden().text_color(t.foreground)
                .child(div().child(result.before)).child(div().bg(t.selection).font_semibold().child(result.match)).child(div().child(result.after)))))
            : this.previewImage ? v_flex().id("files-image-frame").flex_1().min_h(0).p(12).items_center().justify_center()
            .on_size_change((size, cx) => { if (this.imageSize.width !== size.width || this.imageSize.height !== size.height) { this.imageSize = size; cx.notify(); } })
            .when(this.imageSize.width > 24 && this.imageSize.height > 24, el => {
              const scale = Math.min((this.imageSize.width - 24) / this.previewImage.width, (this.imageSize.height - 24) / this.previewImage.height);
              return el.child(image(this.previewImage.path).w(this.previewImage.width * scale).h(this.previewImage.height * scale).flex_none());
            }) : this.code ? (markdown && this.previewMode === "preview"
            ? div().id("files-markdown").flex_1().min_h(0).overflow_y_scrollbar().p(12).child(TextView.markdown("files-markdown-content", this.previewText))
            : Editor.new(this.code).flex_1().min_h(0))
            : div().p(12).text_color(t.dim).child(this.file ? (this.fileError || "Loading file…") : "Select a file to preview")))))));
  }
}
