import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, updates, window, shared, setShared } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const result = find(child, id);
    if (result) return result;
  }
  return null;
}

export default class NookFooter extends View {
  render() {
    const t = theme();
    const width = find(layout(), "sidebar")?.size?.px ?? 268;
    const collapsed = width < 160;
    const compact = collapsed;
    const toggleSidebar = () => {
      if (!collapsed) setShared("sidebar.width", width);
      setShared("sidebar.collapsed", !collapsed);
      run("layout.resize", { id: "sidebar", px: collapsed ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
    };
    const button = (id, icon, label, action) => div().id(id).relative().size(compact ? 18 : 28)
      .flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .cursor_pointer().tooltip(label).on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14));

    return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .px(compact ? 2 : 8).gap(compact ? 1 : 4).items_center()
      .child(button("settings", "settings", "Settings", () => run("app.settings"))
        .when(Boolean(updates().app.ready), el => el.child(div().absolute().top(3).right(3).size(6).rounded_full().bg(t.accent))))
       .child(button("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })))
      .child(div().flex_1())
      .when(!collapsed, el => el.child(button("search", "search", "Search", () => run("mod.open", { name: "picker" })))
        .child(div().id("palette").size(28).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .tooltip("Command Palette").on_click(() => run("app.palette"))
          .child(svg("mods/terminals-bar/command.svg").size(15))))
      .child(button("sidebar-toggle", "sidebar", collapsed ? "Expand sidebar" : "Collapse sidebar", toggleSidebar));
  }
}
