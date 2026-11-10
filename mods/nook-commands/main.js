import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, shared, setShared, spaces, focused, exec, run, theme } from "herdr";

const KEY = "nook.saved-commands";

export default class SavedCommands extends View {
  init(_props, cx) {
    this.selected = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.editing = null;
    this.deleting = null;
    this.error = "";
    this.background = false;
    this.starting = false;
    this.name = InputState.new({ placeholder: "Name" });
    this.command = InputState.new({ placeholder: "Shell command" });
  }

  entries() {
    const value = shared(KEY);
    return Array.isArray(value) ? value : [];
  }

  keyDown(event, cx) {
    if (this.editing !== null || this.deleting !== null || this.starting) return;
    const entries = this.entries();
    if (!entries.length) return;
    this.selected = Math.min(this.selected, entries.length - 1);
    if (event.keystroke === "down") this.selected = (this.selected + 1) % entries.length;
    else if (event.keystroke === "up") this.selected = (this.selected + entries.length - 1) % entries.length;
    else if (event.keystroke === "enter") this.execute(entries[this.selected], cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  showList(cx) {
    this.editing = null;
    this.selected = Math.max(0, Math.min(this.selected, this.entries().length - 1));
    this.handle.focus();
    cx.notify();
  }

  edit(index, cx) {
    const entry = index === -1 ? null : this.entries()[index];
    this.editing = index;
    this.deleting = null;
    this.error = "";
    this.background = entry?.background === true;
    this.name.set_value(entry?.name ?? "");
    this.command.set_value(entry?.command ?? "");
    this.name.focus();
    cx.notify();
  }

  save(cx) {
    const name = this.name.value().trim(), command = this.command.value().trim();
    if (!name || !command) { this.error = "Enter a name and a command."; cx.notify(); return; }
    const entries = this.entries().slice();
    if (this.editing === -1) entries.push({ name, command, background: this.background });
    else if (this.editing >= 0 && this.editing < entries.length) entries[this.editing] = { name, command, background: this.background };
    setShared(KEY, entries);
    this.selected = this.editing === -1 ? entries.length - 1 : this.editing;
    this.showList(cx);
    this.error = "";
    cx.notify();
  }

  execute(entry, cx) {
    if (this.starting) return;
    const target = props();
    if (!target?.space || !spaces().some(space => space.id === target.space)) {
      this.error = "The original Space is no longer available."; cx.notify(); return;
    }
    const args = { space: target.space, name: entry.name, argv: ["sh", "-lc", entry.command] };
    if (target.cwd) args.folder = target.cwd;
    if (!entry.background) {
      closeOverlay(target.overlay);
      run("tab.new", args);
      return;
    }
    this.starting = true;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec("herdr-app", ["do", "tab.new", JSON.stringify(args)]);
        if (result.code !== 0) throw new Error(result.stderr || "Could not start the command.");
        const created = JSON.parse(result.stdout);
        if (!created.tab) throw new Error("Could not identify the new tab.");
        const current = focused();
        if (target.tab && current?.tab === created.tab && current?.space === target.space &&
            spaces().some(space => space.id === target.space && space.tabs.some(tab => tab.id === target.tab))) {
          run("tab.select", { id: target.tab });
        }
        closeOverlay(target.overlay);
      } catch (error) {
        this.starting = false;
        this.error = `Could not start: ${String(error.message ?? error)}`;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme(), entries = this.entries();
    this.selected = Math.max(0, Math.min(this.selected, entries.length - 1));
    const button = (id, label, action) => div().id(id).h(30).px(9).flex().items_center().rounded(6)
      .text_color(t.foreground).hover(s => s.bg(t.hover)).on_click((event, cx) => { cx.stop_propagation(); action(event, cx); }).child(label);
    const input = state => Input.new(state).h(34).px(9).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground);
    const rows = entries.map((entry, index) => {
      return v_flex().h(this.deleting === index ? 111 : 75).flex_none().pb(5).child(
        v_flex().size_full().p(8).gap(5).rounded(7).bg(index === this.selected ? t.selected : t.raised)
          .id(`command-${index}`).on_click((_e, cx) => { this.selected = index; this.handle.focus(); cx.notify(); })
          .child(h_flex().items_center().gap(5)
            .child(div().flex_1().min_w(0).truncate().font_semibold().child(entry.name))
            .child(button(`run-${index}`, "Run", (_e, cx) => this.execute(entry, cx)))
            .child(button(`edit-${index}`, "Edit", (_e, cx) => this.edit(index, cx)))
            .child(button(`delete-${index}`, "Delete", (_e, cx) => { this.selected = index; this.deleting = index; this.handle.focus(); cx.notify(); })))
          .child(div().text_color(t.dim).truncate().child(`${entry.background ? "Background" : "Foreground"} · ${entry.command}`))
          .when(this.deleting === index, x => x.child(h_flex().items_center().gap(6)
            .child(div().flex_1().text_color(t.blocked).child("Delete this command?"))
            .child(button(`cancel-delete-${index}`, "Cancel", (_e, cx) => { this.deleting = null; this.handle.focus(); cx.notify(); }))
            .child(button(`confirm-delete-${index}`, "Delete", (_e, cx) => {
              const next = this.entries().slice(); next.splice(index, 1); setShared(KEY, next); this.deleting = null; this.showList(cx);
            })))));
    });
    return v_flex().id("saved-commands").track_focus(this.handle)
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .size_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(12).text_color(t.foreground)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(15).font_semibold().child("Saved commands"))
        .child(button("close", "✕", () => closeOverlay(props().overlay))))
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().min_w(0).text_color(t.dim).child(this.starting ? "Starting command…" : "Run in a new tab in the current Space and folder."))
        .when(this.editing === null, el => el.child(button("add", "+ Add command", (_e, cx) => this.edit(-1, cx)).flex_none())))
      .when(this.editing === null, el => el
        .when(entries.length === 0, x => x.child(div().text_color(t.dim).child("No saved commands yet.")))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(rows)))
      .when(this.editing === null && entries.length > 0, el => el.child(div().text_color(t.dim).truncate().child(`↑ ↓ Select · Enter Run · ${entries[this.selected]?.name ?? ""}`)))
      .when(this.editing !== null, el => el
        .child(div().font_semibold().child(this.editing === -1 ? "Add command" : "Edit command"))
        .child(input(this.name)).child(input(this.command))
        .child(h_flex().items_center().gap(8).child(div().text_color(t.dim).child("Run mode"))
          .child(button("mode-foreground", this.background ? "Foreground" : "● Foreground", (_e, cx) => { this.background = false; cx.notify(); }))
          .child(button("mode-background", this.background ? "● Background" : "Background", (_e, cx) => { this.background = true; cx.notify(); })))
        .child(div().text_color(t.dim).child("Runs with sh -lc on the Space's machine."))
        .child(h_flex().gap(8)
          .child(button("cancel-edit", "Cancel", (_e, cx) => { this.error = ""; this.showList(cx); }))
          .child(button("save", "Save", (_e, cx) => this.save(cx)))))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)));
  }
}
