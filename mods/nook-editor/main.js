import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { closeOverlay, exec, hc, props, theme } from "herdr";

const EDITORS = ["Visual Studio Code", "Zed"];
function remoteUri(editor, target, folder) {
  if (!/^(?:[\w.-]+@)?[\w.-]+(?::\d+)?$/.test(target) || !folder.startsWith("/"))
    throw new Error("Unsupported SSH target or folder. Use an SSH config host alias and an absolute folder.");
  if (editor === "Visual Studio Code" && /:\d+$/.test(target))
    throw new Error("For VS Code, put the port in ~/.ssh/config and add the machine using that host alias.");
  const path = folder.split("/").map(encodeURIComponent).join("/");
  return editor === "Zed" ? `zed://ssh/${target}${path}` : `vscode://vscode-remote/ssh-remote+${target}${path}`;
}

export default class EditorPicker extends View {
  init(_props, cx) {
    this.loading = true;
    this.installed = [];
    this.error = null;
    cx.spawn(async cx => {
      for (const name of EDITORS) {
        try { if ((await exec("/usr/bin/open", ["-Ra", name])).code === 0) this.installed.push(name); } catch {}
      }
      this.loading = false;
      cx.notify();
    });
  }

  open(name, cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const { folder, machine } = props();
        let r;
        if (machine) {
          const listing = await hc(["machine", "ls", "--json"]);
          if (listing.code !== 0) throw new Error("Could not read Herdr machines.");
          const remote = (JSON.parse(listing.stdout).machines ?? []).find(m => m.name === machine);
          if (!remote || !remote.target) throw new Error("SSH target is unavailable for this machine.");
          if (remote.via) throw new Error("Custom --via connections are not supported. Add an SSH config host instead.");
          r = await exec("/usr/bin/open", ["-a", name, remoteUri(name, remote.target, folder)]);
        } else r = await exec("/usr/bin/open", ["-a", name, "--", folder]);
        if (r.code !== 0) throw new Error(r.stderr || "Could not open the folder.");
        closeOverlay(props().overlay);
      } catch (e) {
        this.busy = false;
        this.error = String(e.message ?? e);
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    return v_flex().w_full().p(8).gap(3).text_size(12).bg(t.popover)
      .child(div().px(6).text_size(11).text_color(t.dim).child("Open folder in"))
      .when(this.loading, el => el.child(div().p(6).text_color(t.muted).child("Looking for editors…")))
      .when(!this.loading && !this.installed.length, el => el.child(div().p(6).text_color(t.muted).child("VS Code and Zed were not found.")))
      .children(this.installed.map(name => div().id(`open-${name}`).px(6).py(5).text_size(12).rounded(5).text_color(t.foreground)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.open(name, cx)).child(name)))
      .when(Boolean(this.error), el => el.child(div().p(6).text_size(11).text_color(t.blocked).child(this.error)));
  }
}
