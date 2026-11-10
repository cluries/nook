import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, exec, hc, props, theme, notify } from "herdr";

const ITEMS = ["Open With Zed", "Open With VSCode", "Copy Relative Path"];

function remoteUri(editor, target, path) {
  if (!/^(?:[\w.-]+@)?[\w.-]+(?::\d+)?$/.test(target) || !path.startsWith("/"))
    throw new Error("Unsupported SSH target or path. Use an SSH config host alias and an absolute path.");
  if (editor === "Visual Studio Code" && /:\d+$/.test(target))
    throw new Error("For VS Code, put the port in ~/.ssh/config and use that host alias.");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return editor === "Zed" ? `zed://ssh/${target}${encoded}` : `vscode://vscode-remote/ssh-remote+${target}${encoded}`;
}

export default class FilesMenu extends View {
  init(_props, cx) {
    this.at = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(index, cx) {
    if (this.busy) return;
    const { root, path, machine, overlay } = props();
    if (index === 2) {
      cx.write_to_clipboard(path);
      closeOverlay(overlay);
      return;
    }
    const editor = index === 0 ? "Zed" : "Visual Studio Code";
    this.busy = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const fullPath = `${root.replace(/[\\/]+$/, "")}/${path}`;
        let result;
        if (machine) {
          const listing = await hc(["machine", "ls", "--json"]);
          if (listing.code !== 0) throw new Error("Could not read Herdr machines.");
          const remote = (JSON.parse(listing.stdout).machines ?? []).find(m => m.name === machine);
          if (!remote?.target) throw new Error("SSH target is unavailable for this machine.");
          if (remote.via) throw new Error("Custom --via connections are not supported. Use an SSH config host.");
          result = await exec("/usr/bin/open", ["-a", editor, remoteUri(editor, remote.target, fullPath)]);
        } else {
          result = await exec("/usr/bin/open", ["-a", editor, "--", fullPath]);
        }
        if (result.code !== 0) throw new Error(result.stderr || "Could not open the path.");
        closeOverlay(overlay);
      } catch (e) {
        notify({ title: "Could not open in editor", body: String(e.message ?? e), level: "error" });
        closeOverlay(overlay);
      }
    });
  }

  render() {
    const t = theme();
    return v_flex().id("files-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up") this.at = this.at < 0 ? ITEMS.length - 1 : (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter" && this.at >= 0) this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(ITEMS.map((label, index) => h_flex().id(`files-menu-${index}`).h(31).px(8).gap(9).items_center().rounded(7)
        .text_color(t.foreground).when(index === this.at, el => el.bg(t.selected))
        .on_hover((hovered, cx) => {
          const next = hovered ? index : (this.at === index ? -1 : this.at);
          if (next !== this.at) { this.at = next; cx.notify(); }
        }).on_click((_e, cx) => this.choose(index, cx))
        .child(index === 2 ? svg("mods/workspace-chrome/files.svg").size(14).flex_none().text_color(t.muted)
          : image(`mods/nook-files-menu/${index === 0 ? "zed" : "vscode"}.png`).size(16).flex_none())
        .child(div().flex_1().child(label))));
  }
}
