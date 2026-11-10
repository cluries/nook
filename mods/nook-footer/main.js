import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, updates } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const result = find(child, id);
    if (result) return result;
  }
  return null;
}

export default class NookFooter extends View {
  init(_props, cx) {
    cx.timer.every(1000, cx => cx.notify());
  }

  render() {
    const t = theme();
    const width = find(layout(), "sidebar")?.size?.px ?? 268;
    const compact = width < 76;
    const now = new Date();
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => String(value).padStart(2, "0")).join(":");
    const button = (id, icon, label, action) => div().id(id).relative().size(compact ? 18 : 28)
      .flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .cursor_pointer().tooltip(label).on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14));

    return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .px(compact ? 2 : 8).gap(4).items_center()
      .child(button("settings", "settings", "Settings", () => run("app.settings"))
        .when(Boolean(updates().app.ready), el => el.child(div().absolute().top(3).right(3).size(6).rounded_full().bg(t.accent))))
      .child(button("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })))
      .when(width >= 160, el => el.child(div().flex_1()).child(
        h_flex().flex_none().text_size(12).text_color(t.dim).children(
          [...time].map(char => div().w(8).flex_none().flex().justify_center().child(char))
        )
      ));
  }
}
