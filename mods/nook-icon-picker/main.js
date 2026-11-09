import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, props, closeOverlay, spaces, shared, setShared, theme } from "herdr";
import { readdir } from "fs/promises";

const SOURCES = ["mods/workspace-chrome", "icons"];

export default class IconPicker extends View {
  init(_props, cx) {
    this.icons = [];
    this.loading = true;
    this.error = "";
    this.query = "";
    this.randomPreview = null;
    this.input = InputState.new({ placeholder: "Search icon name…" });
    this.input.on("change", (_event, cx) => { this.query = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.input.on("submit", (_event, cx) => {
      const matches = this.matches();
      const exact = matches.find(icon => icon.name.toLowerCase() === this.query);
      if (exact || matches.length === 1) this.select((exact || matches[0]).path);
    });
    this.input.focus();
    cx.spawn(async cx => {
      const results = await Promise.all(SOURCES.map(async source => {
        try {
          const files = await readdir(`${appHome()}/${source}`);
          return { icons: files.filter(name => /^[a-zA-Z0-9_-]+\.svg$/.test(name)).map(file => ({ name: file.slice(0, -4), path: `${source}/${file}` })) };
        } catch { return { icons: [], failed: source }; }
      }));
      this.icons = results.flatMap(result => result.icons).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
      const failed = results.filter(result => result.failed).map(result => result.failed);
      this.error = failed.length ? `Could not load: ${failed.join(", ")}` : "";
      this.loading = false;
      cx.notify();
    });
  }

  matches() { return this.icons.filter(icon => icon.name.toLowerCase().includes(this.query)); }

  select(path) {
    const id = props()?.target?.id;
    if (id && spaces().some(space => space.id === id)) {
      const icons = { ...(shared("nook.spaces.icons") ?? {}) };
      if (path) icons[id] = path;
      else delete icons[id];
      setShared("nook.spaces.icons", icons);
    }
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const matches = this.matches();
    const chosen = (shared("nook.spaces.icons") ?? {})[props()?.target?.id];
    const rows = [];
    for (let i = 0; i < matches.length; i += 7) rows.push(matches.slice(i, i + 7));
    const button = (id, label, action) => div().id(id).px(10).h(30).flex().items_center().rounded(6).text_color(t.foreground).hover(s => s.bg(t.hover)).on_click(action).child(label);
    return v_flex().id("icon-picker").size_full().min_h(0).p(12).gap(8).bg(t.popover).text_size(12)
      .child(h_flex().items_center().justify_between().child(div().font_semibold().text_color(t.foreground).child("Choose icon"))
        .child(button("close", "✕", () => closeOverlay(props().overlay))))
      .child(Input.new(this.input).h(34).flex_none().px(9).rounded(7).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .child(h_flex().items_center().gap(4)
        .child(button("automatic", "Automatic", () => this.select(null)))
        .child(button("random", this.randomPreview ? "Draw again" : "Random", (_event, cx) => { if (matches.length) { this.randomPreview = matches[Math.floor(Math.random() * matches.length)]; cx.notify(); } }))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "Loading…" : `${matches.length} icons`)))
      .when(Boolean(this.randomPreview), el => el.child(
        h_flex().h(58).flex_none().px(8).gap(10).items_center().rounded(7).bg(t.raised)
          .child(svg(this.randomPreview.path).size(30).flex_none().text_color(t.foreground))
          .child(v_flex().flex_1().min_w(0)
            .child(div().truncate().text_color(t.foreground).child(this.randomPreview.name))
            .child(div().text_size(10).text_color(t.dim).child("Random preview")))
          .child(button("save-random", "Use icon", () => this.select(this.randomPreview.path)))
      ))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!this.loading && matches.length === 0, el => el.child(div().text_color(t.dim).child("No matching icons")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(rows.map((row, ri) =>
        h_flex().gap(2).children(row.map((icon, ci) => div().id(`icon-${ri}-${ci}`).size(38).flex_none().flex().items_center().justify_center().rounded(6)
          .when(chosen === icon.path || (chosen === icon.name && icon.path === `mods/workspace-chrome/${icon.name}.svg`), el => el.bg(t.selected))
          .hover(s => s.bg(t.hover)).tooltip(`${icon.name} (${icon.path.startsWith("icons/") ? "program" : "interface"})`)
          .on_click(() => this.select(icon.path))
          .child(svg(icon.path).size(19).text_color(t.foreground)))))));
  }
}
