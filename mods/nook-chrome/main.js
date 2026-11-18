import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, layout, theme, window } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    cx.timer.every(1000, cx => {
      if (window().active && (find(layout(), "sidebar")?.size?.px ?? 268) >= 160) cx.notify();
    });
  }

  render() {
    const t = theme(), w = window();
    const collapsed = (find(layout(), "sidebar")?.size?.px ?? 268) < 160;
    const now = new Date();
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => String(value).padStart(2, "0")).join(":");
    const needs = agents().filter(a => a.status === "blocked").length;
    return h_flex().size_full().bg(t.chrome).pl(14).pr(10).gap(8).items_center()
      .when(w?.platform === "macos" && !w.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(div().flex_1()).child(h_flex().gap(4).items_center().flex_none().text_size(12).text_color(t.dim)
        .child(svg("mods/workspace-chrome/clock.svg").size(15))
        .child(h_flex().children([...time].map(char => div().w(char === ":" ? 4 : 8).flex_none().flex().justify_center().child(char)))))
        .child(h_flex().h(26).px(6).gap(4).flex_none().items_center().rounded(5)
          .bg(needs > 0 ? t.blocked + "26" : t.chrome)
          .text_color(needs > 0 ? t.blocked : t.dim).text_size(12).font_semibold()
          .tooltip(`${needs} agents need attention`)
          .child(svg("mods/nook-tabs/lens.svg").size(15))
          .child(div().h_full().flex().items_center().child(String(needs)))));
  }
}
