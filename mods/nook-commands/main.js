import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, shared, setShared, spaces, run, theme } from "herdr";

const KEY = "nook.saved-commands";

export default class SavedCommands extends View {
  init() {
    this.editing = null;
    this.deleting = null;
    this.error = "";
    this.name = InputState.new({ placeholder: "Name" });
    this.command = InputState.new({ placeholder: "Shell command" });
  }

  entries() {
    const value = shared(KEY);
    return Array.isArray(value) ? value : [];
  }

  edit(index, cx) {
    const entry = index === -1 ? null : this.entries()[index];
    this.editing = index;
    this.deleting = null;
    this.error = "";
    this.name.set_value(entry?.name ?? "");
    this.command.set_value(entry?.command ?? "");
    this.name.focus();
    cx.notify();
  }

  save(cx) {
    const name = this.name.value().trim(), command = this.command.value().trim();
    if (!name || !command) { this.error = "Enter a name and a command."; cx.notify(); return; }
    const entries = this.entries().slice();
    if (this.editing === -1) entries.push({ name, command });
    else if (this.editing >= 0 && this.editing < entries.length) entries[this.editing] = { name, command };
    setShared(KEY, entries);
    this.editing = null;
    this.error = "";
    cx.notify();
  }

  execute(entry, cx) {
    const target = props();
    if (!target?.space || !spaces().some(space => space.id === target.space)) {
      this.error = "The original Space is no longer available."; cx.notify(); return;
    }
    const args = { space: target.space, name: entry.name, argv: ["sh", "-lc", entry.command] };
    if (target.cwd) args.folder = target.cwd;
    closeOverlay(target.overlay);
    run("tab.new", args);
  }

  render() {
    const t = theme(), entries = this.entries();
    const button = (id, label, action) => div().id(id).h(30).px(9).flex().items_center().rounded(6)
      .text_color(t.foreground).hover(s => s.bg(t.hover)).on_click(action).child(label);
    const input = state => Input.new(state).h(34).px(9).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground);
    return v_flex().size_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(12).text_color(t.foreground)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(15).font_semibold().child("Saved commands"))
        .child(button("close", "✕", () => closeOverlay(props().overlay))))
      .child(div().text_color(t.dim).child("Run in a new tab in the current Space and folder."))
      .when(this.editing === null, el => el
        .child(button("add", "+ Add command", (_e, cx) => this.edit(-1, cx)))
        .when(entries.length === 0, x => x.child(div().text_color(t.dim).child("No saved commands yet.")))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(5).children(entries.map((entry, index) =>
          v_flex().p(8).gap(5).rounded(7).bg(t.raised)
            .child(h_flex().items_center().gap(5)
              .child(div().flex_1().min_w(0).truncate().font_semibold().child(entry.name))
              .child(button(`run-${index}`, "Run", (_e, cx) => this.execute(entry, cx)))
              .child(button(`edit-${index}`, "Edit", (_e, cx) => this.edit(index, cx)))
              .child(button(`delete-${index}`, "Delete", (_e, cx) => { this.deleting = index; cx.notify(); })))
            .child(div().text_color(t.dim).truncate().child(entry.command))
            .when(this.deleting === index, x => x.child(h_flex().items_center().gap(6)
              .child(div().flex_1().text_color(t.blocked).child("Delete this command?"))
              .child(button(`cancel-delete-${index}`, "Cancel", (_e, cx) => { this.deleting = null; cx.notify(); }))
              .child(button(`confirm-delete-${index}`, "Delete", (_e, cx) => {
                const next = this.entries().slice(); next.splice(index, 1); setShared(KEY, next); this.deleting = null; cx.notify();
              }))))))))
      .when(this.editing !== null, el => el
        .child(div().font_semibold().child(this.editing === -1 ? "Add command" : "Edit command"))
        .child(input(this.name)).child(input(this.command))
        .child(div().text_color(t.dim).child("Runs with sh -lc on the Space's machine."))
        .child(h_flex().gap(8)
          .child(button("cancel-edit", "Cancel", (_e, cx) => { this.editing = null; this.error = ""; cx.notify(); }))
          .child(button("save", "Save", (_e, cx) => this.save(cx)))))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)));
  }
}
