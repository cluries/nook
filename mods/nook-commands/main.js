import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
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
    this.command = TextareaState.new({ placeholder: "e.g. npm run dev", rows: 3 });
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
    const iconButton = (id, icon, label, action) => button(id,
      svg(`mods/workspace-chrome/${icon}.svg`).size(14), action).px(7).text_color(t.muted).tooltip(label);
    const rows = entries.map((entry, index) =>
      v_flex().flex_none().p(10).gap(6).rounded(8).border_1()
        .border_color(index === this.selected ? t.accent : t.border)
        .bg(index === this.selected ? t.raised : t.popover)
        .id(`command-${index}`).on_click((_e, cx) => { this.selected = index; this.handle.focus(); cx.notify(); })
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().min_w(0).truncate().font_semibold().child(entry.name))
          .child(div().text_size(10).text_color(t.muted).px(6).py(2).rounded(4).bg(t.chrome)
            .child(entry.background ? "Background" : "Foreground"))
          .child(button(`run-${index}`, "Run ↵", (_e, cx) => this.execute(entry, cx))
            .text_color(index === this.selected ? t.accent : t.muted))
          .child(iconButton(`edit-${index}`, "square-pen", "Edit command", (_e, cx) => this.edit(index, cx)))
          .child(button(`delete-${index}`, "Delete", (_e, cx) => { this.selected = index; this.deleting = index; this.handle.focus(); cx.notify(); })
            .text_size(11).text_color(t.dim)))
        .child(div().text_size(11).text_color(t.muted).truncate().tooltip(entry.command).child(entry.command))
        .when(this.deleting === index, x => x.child(h_flex().items_center().gap(6).pt(6).border_t(1).border_color(t.border)
          .child(div().flex_1().text_color(t.blocked).child("Delete this command?"))
          .child(button(`cancel-delete-${index}`, "Cancel", (_e, cx) => { this.deleting = null; this.handle.focus(); cx.notify(); }))
          .child(button(`confirm-delete-${index}`, "Delete", (_e, cx) => {
            const next = this.entries().slice(); next.splice(index, 1); setShared(KEY, next); this.deleting = null; this.showList(cx);
          }).text_color(t.blocked)))));
    const field = (label, control) => v_flex().gap(6).child(div().text_size(11).text_color(t.muted).child(label)).child(control);
    const mode = (background, title, detail) => v_flex().flex_1().min_w(0).p(9).gap(4).rounded(7).border_1()
      .border_color(this.background === background ? t.accent : t.border)
      .bg(this.background === background ? t.raised : t.popover)
      .id(`mode-${background ? "background" : "foreground"}`)
      .on_click((_e, cx) => { this.background = background; cx.notify(); })
      .child(div().font_semibold().child(`${this.background === background ? "● " : ""}${title}`))
      .child(div().text_size(11).text_color(t.muted).child(detail));
    return v_flex().id("saved-commands").track_focus(this.handle)
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .w_full().min_h(0).p(16).gap(12).bg(t.popover).text_size(12).text_color(t.foreground)
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/workspace-chrome/terminal.svg").size(17).text_color(t.accent))
        .child(div().flex_1().text_size(15).font_semibold().child(this.editing === null ? "Saved commands" : this.editing === -1 ? "Add command" : "Edit command"))
        .when(this.editing === null, el => el.child(button("add", "+ Add command", (_e, cx) => this.edit(-1, cx)).text_color(t.accent)))
        .child(iconButton("close", "x", "Close", () => closeOverlay(props().overlay))))
      .when(this.editing === null, el => el
        .when(entries.length === 0, x => x.child(div().py(24).text_color(t.muted).child("Save a command to run it again with a keystroke.")))
        .child(v_flex().h(Math.min(320, entries.length * 79 + (this.deleting === null ? 0 : 40))).min_h(0).overflow_y_scrollbar().gap(7).children(rows))
        .child(h_flex().items_center().justify_between().pt(10).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
          .child(div().child(this.starting ? "Starting command…" : "↑ ↓ Select    ↵ Run    Esc Close"))
          .child(div().child(entries.length ? `${this.selected + 1} / ${entries.length}` : "No commands"))))
      .when(this.editing !== null, el => el
        .child(field("Name", input(this.name)))
        .child(field("Shell command", Textarea.new(this.command).h(78).px(10).py(8).rounded(7).border_1()
          .border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12)))
        .child(field("Run mode", h_flex().gap(8)
          .child(mode(false, "Foreground", "Switch to the new tab"))
          .child(mode(true, "Background", "Return to the current tab"))))
        .child(h_flex().items_center().gap(8).pt(10).border_t(1).border_color(t.border)
          .child(div().flex_1().text_size(11).text_color(t.dim).child("New tab · Current Space and folder"))
          .child(button("cancel-edit", "Cancel", (_e, cx) => { this.error = ""; this.showList(cx); }).text_color(t.muted))
          .child(button("save", this.editing === -1 ? "Add command" : "Save changes", (_e, cx) => this.save(cx))
            .bg(t.solid).text_color(t.solid_foreground).hover(s => s.bg(t.solid)))))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)));
  }
}
