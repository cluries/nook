// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Index folders in pane order, preserving the first available cwd across all
// tabs in a space (not tab order). Rebuild for each render or Git polling pass.
function locations(sp, ps) {
  const spaceOf = new Map();
  const folders = new Map(sp.map(s => [s.id, s.folder]));
  for (const s of sp) for (const tab of s.tabs ?? []) spaceOf.set(tab.id, s.id);
  const found = new Set();
  for (const pane of ps) {
    const id = spaceOf.get(pane.tab);
    if (id === undefined || !pane.cwd || found.has(id)) continue;
    folders.set(id, pane.cwd);
    found.add(id);
  }
  return new Map(sp.map(s => [s.id, {
    folder: folders.get(s.id),
    key: JSON.stringify([s.machine ?? null, folders.get(s.id)]),
  }]));
}
const rowHeight = () => 48;
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// Sample CPU over one second. Memory excludes reclaimable cache on both systems.
const METRICS = `case "$(uname -s)" in
Linux)
  read _ u n s i w q z rest < /proc/stat
  a=$((u+n+s+i+w+q+z)); b=$((i+w))
  sleep 1
  read _ u n s i w q z rest < /proc/stat
  c=$((u+n+s+i+w+q+z)); d=$((i+w))
  awk -v total="$((c-a))" -v idle="$((d-b))" '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (total>0 && t>0 && a>0) printf "%.0f %.1f %.1f\\n", 100*(total-idle)/total, (t-a)/1048576, t/1048576}' /proc/meminfo ;;
Darwin)
  cpu=$(LC_ALL=C top -l 2 -n 0 -s 1 | awk '/CPU usage/ {gsub(/%/, "", $7); idle=$7} END {if (idle != "") printf "%.0f", 100-idle}')
  total=$(sysctl -n hw.memsize)
  vm_stat | awk -v cpu="$cpu" -v total="$total" 'NR==1 {gsub(/\\./,"",$8); page=$8} /Pages active:/ {active=$3} /Pages wired down:/ {wired=$4} /Pages occupied by compressor:/ {compressed=$5} END {gsub(/\\./,"",active); gsub(/\\./,"",wired); gsub(/\\./,"",compressed); if (cpu != "" && total>0 && page>0) printf "%s %.1f %.1f\\n", cpu, (active+wired+compressed)*page/1073741824, total/1073741824}' ;;
esac`;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// Herdr ships these Lucide glyphs. Hash the ID so the choice stays stable.
const SPACE_ICONS = ["folder", "terminal", "layers", "monitor", "files", "git-branch", "server", "file-text"];
function spaceIcon(id) {
  const selected = (shared("nook.spaces.icons") ?? {})[id];
  if (typeof selected === "string" && /^(?:mods\/workspace-chrome|icons)\/[a-zA-Z0-9_-]+\.svg$/.test(selected)) return selected;
  if (SPACE_ICONS.includes(selected)) return `mods/workspace-chrome/${selected}.svg`;
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `mods/workspace-chrome/${SPACE_ICONS[(hash >>> 0) % SPACE_ICONS.length]}.svg`;
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // location key -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // location key -> when it was last looked at
    this.unsure = new Set(); // locations git couldn't answer for (a machine away)
    this.pending = new Set(); // locations to look at next
    this.checking = new Set(); // locations in the current Git batch
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its location key at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hoveredSpace = null;
    this.machines = [];
    this.metrics = {};
    this.metricsBusy = new Set();
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    this.refreshMetrics(cx);
    cx.timer.every(10000, cx => this.refreshMetrics(cx));
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  refreshMetrics(cx) {
    const targets = [null, ...machines().filter(m => m.name && m.layout === "ready").map(m => m.name)];
    for (const on of targets) {
      const key = on ?? "";
      if (this.metricsBusy.has(key)) continue;
      this.metricsBusy.add(key);
      cx.spawn(async cx => {
        try {
          const r = await exec("sh", ["-c", METRICS], { on, timeout: 5000 });
          const match = r.code === 0 && r.stdout.trim().match(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$/);
          this.metrics[key] = match ? { cpu: match[1], used: match[2], total: match[3] } : null;
        } catch { this.metrics[key] = null; }
        this.metricsBusy.delete(key);
        cx.notify();
      });
    }
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    const places = locations(sp, ps);
    for (const s of sp) at[s.id] = places.get(s.id).key;
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    // A slow first query still has no cached result. Don't enqueue it again
    // on every poll; subsequent invalidations below must still get a new pass.
    const due = new Set([...keys].filter(k => !(k in this.git)
      && !this.pending.has(k) && !this.checking.has(k)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    if (this.machinesBusy) return;
    this.machinesBusy = true;
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) {
          const next = (JSON.parse(r.stdout).machines ?? []).filter(m => !m.temporary);
          if (JSON.stringify(next) !== JSON.stringify(this.machines)) {
            this.machines = next;
            cx.notify();
          }
        }
      } catch {}
      finally { this.machinesBusy = false; }
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        this.checking = new Set(keys);
        for (const key of keys) {
          try { await this.check(key, cx); }
          finally { this.checking.delete(key); }
        }
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      if (top.code !== 0 || common.code !== 0) { this.unsure.add(key); this.git[key] = null; return; }
      const info = { name, branch: null, ahead: 0, behind: 0, changes: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
        else if (/^(1 |2 |u |\? )/.test(line)) info.changes++;
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "nook-space-menu", kind: "popup", width: 200, height: 340, props: { tab: "space", target: { id: w.id } } });
  }

  togglePin(id, cx) {
    const pins = { ...(shared("nook.spaces.pinned") ?? {}) };
    if (pins[id]) delete pins[id];
    else pins[id] = true;
    setShared("nook.spaces.pinned", pins);
    cx.notify();
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered(sp, places, liveMachines) {
    const ready = (w) => this.shown.has(w.id) || places.get(w.id).key in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[places.get(w.id).key] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const children = new Map();
    for (const r of list) if (nested(r)) {
      if (!children.has(r.g.repo)) children.set(r.g.repo, []);
      children.get(r.g.repo).push(r);
    }
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = children.get(r.g.repo) ?? [];
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, liveMachines]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed, sp) {
    // Native getters copy their full collections. Share one render snapshot
    // across rows; event handlers still read live data when invoked.
    const places = locations(sp, panes()), liveMachines = machines();
    const machineLayouts = new Map(liveMachines.map(m => [m.name, m.layout]));
    const agentCounts = new Map();
    for (const agent of agents()) agentCounts.set(agent.space, (agentCounts.get(agent.space) ?? 0) + 1);
    const snapshot = {
      places, machineLayouts, agentCounts,
      fromIndex: this.pressed === null ? -1 : sp.findIndex(s => s.id === this.pressed),
      pins: shared("nook.spaces.pinned") ?? {},
      icons: shared("nook.spaces.icons") ?? {},
      colors: shared("space.colors") ?? {},
    };
    const rows = this.ordered(sp, places, liveMachines);
    const pins = snapshot.pins;
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t, snapshot));
    const groups = new Map();
    for (const r of rows) {
      const m = r.w.machine ?? null;
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(r);
    }
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machineLayouts.get(m);
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length && collapsed) return loading(null) && !rows.length ? [loadingRow(null)] : [...rows.filter(r => pins[r.w.id]), ...rows.filter(r => !pins[r.w.id])].map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const group = groups.get(m) ?? [];
      // Pinning is a view-only partition: the underlying manual order stays intact.
      const parents = [new Set(), new Set()];
      for (const r of group) if (!r.tree) parents[Number(Boolean(pins[r.w.id]))].add(r.g?.repo);
      const mine = [...group.filter(r => pins[r.w.id]), ...group.filter(r => !pins[r.w.id])]
        .map(r => r.tree && !parents[Number(Boolean(pins[r.w.id]))].has(r.g?.repo) ? { ...r, tree: null } : r);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(Boolean(m) && collapsed, el => el.mt(8))
        .when(collapsed, el => el.w(RAIL_CELL).justify_center().rounded(6).tooltip(m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      const cell = collapsed ? railCell : (el) => el;
      const available = connected && (!m || machineLayouts.get(m) === "ready");
      const metric = available ? this.metrics[m ?? ""] : null;
      const status = metric === undefined ? "Loading metrics…" : "Metrics unavailable";
      const tile = (label, value, color) => h_flex().when(label === "CPU", el => el.w(76).flex_none()).when(label !== "CPU", el => el.flex_1()).min_w(0).h(27).px(8).gap(5).items_center().rounded(5).bg(t.chrome)
        .child(div().size(5).flex_none().rounded(3).bg(color))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(label))
        .child(div().flex_1().min_w(0).text_size(10).text_color(t.foreground).truncate().child(value));
      const metricsRow = h_flex().id(`machine-metrics-${m ?? "local"}`).px(4).pb(5).gap(4).min_w(0)
        .when(Boolean(metric), el => el.tooltip(`CPU ${metric.cpu}% · Memory ${metric.used} / ${metric.total} GB`)
          .child(tile("CPU", `${metric.cpu}%`, t.ansi6))
          .child(tile("MEM", `${metric.used} / ${metric.total} GB`, t.ansi3)))
        .when(!metric, el => el.child(div().px(4).text_size(10).text_color(t.dim).child(status)));
      const items = [cell(head), ...(!collapsed && !folded ? [metricsRow] : []), ...(!collapsed && rebuilt || folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      if (collapsed) return items;
      return [v_flex().id(`machine-card-${m ?? "local"}`).flex_none().min_w(0).p(4).rounded(8).bg(t.surface)
        .when(Boolean(m), el => el.mt(8)).children(items)];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t, snapshot) {
    const on = w.active;
    const pinned = Boolean(snapshot.pins[w.id]);
    const chosenIcon = snapshot.icons[w.id];
    const customIcon = SPACE_ICONS.includes(chosenIcon) || (typeof chosenIcon === "string" && /^(?:mods\/workspace-chrome|icons)\/[a-zA-Z0-9_-]+\.svg$/.test(chosenIcon));
    const fromIndex = snapshot.fromIndex;
    const colors = snapshot.colors;
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const { folder, key } = snapshot.places.get(w.id);
    const uncertain = this.unsure.has(key) || !(key in this.git) || (w.machine && snapshot.machineLayouts.get(w.machine) !== "ready");
    const details = [];
    if (uncertain) details.push("Git unknown");
    else if (g) {
      details.push(g.branch && g.branch !== "(detached)" ? g.branch : "detached");
      if (g.changes) details.push(`${g.changes} changed`);
      if (g.ahead) details.push(`↑${g.ahead}`);
      if (g.behind) details.push(`↓${g.behind}`);
    } else if (folder) details.push(folder);
    if (w.tabs.length > 1) details.push(`${w.tabs.length} tabs`);
    const count = snapshot.agentCounts.get(w.id) ?? 0;
    const status = { blocked: "Needs attention", working: "Working", done: "Done", idle: "Idle" }[w.status];
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((hovered, cx) => { this.hoveredSpace = hovered ? w.id : (this.hoveredSpace === w.id ? null : this.hoveredSpace); cx.notify(); })
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const pins = shared("nook.spaces.pinned") ?? {};
        const over = source && (source.machine ?? null) === (w.machine ?? null) && Boolean(pins[source.id]) === Boolean(pins[w.id]) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(h_flex().gap(7).items_center().min_w(0)
        .when(Boolean(tree) && !customIcon, el => el.pl(18).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
        .when(Boolean(tree) && customIcon, el => el.pl(18).child(svg(spaceIcon(w.id)).size(13).text_color(fill)))
        .when(!tree, el => el.child(h_flex().size(18).flex_none().items_center().justify_center().child(svg(spaceIcon(w.id)).size(16).text_color(fill))))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().items_center().gap(5).min_w(0)
            .child(div().min_w(0).truncate().text_color(t.foreground).child(w.name))
            .when(Boolean(status), el => el.child(div().flex_none().text_size(10).text_color(t[w.status]).child(`${status}${count > 1 ? ` ${count}` : ""}`))))
          .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(details.join(" · ") || " ")))
        .when(pinned || this.hoveredSpace === w.id, el => el.child(div().id(`pin-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(pinned ? t.accent : t.dim)
          .tooltip(pinned ? "Unpin space" : "Pin space")
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.togglePin(w.id, cx); })
          .child(svg("mods/workspace-chrome/pin.svg").size(12))))
        .child(div().id(`editor-${w.id}`).size(24).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .tooltip(folder ? "Open in editor" : "No current folder")
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); if (folder) openOverlay({ mod: "nook-editor", kind: "popup", width: 260, height: 220, props: { folder, machine: w.machine ?? null } }); })
          .child(svg("mods/nook-spaces/package-pen.svg").size(13))));
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    const uses = new Map(palette.map(c => [c, 0]));
    for (const color of Object.values(kept)) uses.set(color, (uses.get(color) ?? 0) + 1);
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      kept[p.id] = palette.reduce((best, c) => uses.get(c) < uses.get(best) ? c : best);
      uses.set(kept[p.id], uses.get(kept[p.id]) + 1);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed, sp)));
  }
}
