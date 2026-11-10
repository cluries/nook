# Nook

Nook is a personal project for managing Herdr App themes, layouts, and mods.

## Directories

- `themes/`: Window and terminal themes. `Gruvbox Dark.json` was copied from the current Herdr configuration, with terminal colors from [Gruvbox Dark in iTerm2 Color Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes/blob/master/schemes/Gruvbox%20Dark.itermcolors) and additional interface colors.
- `mods/`: Custom panels and interactions.
- `layouts/`: Layouts that reference custom mods.

## Development and installation

Herdr App loads its configuration from `~/.config/herdr-app/`, not directly from this project. The two directories currently contain separate files. The installation script copies the project's themes, layouts, and mods without deleting other files in the destination:

```sh
python3 scripts/install.py --dry-run
python3 scripts/install.py
```

If a destination file already has different content, the script stops without copying any files. After reviewing the differences, use `python3 scripts/install.py --force` to overwrite conflicting files. By default, the script uses `HERDR_APP_HOME` if set, or `~/.config/herdr-app` otherwise. Use `--home <directory>` to specify a destination. After installing a theme, select it in Herdr's theme picker.

Herdr updates its built-in mods and layouts. To customize one, first copy it under a new name and have the custom layout reference the custom mod. Symbolic links and hot reload have not yet been verified in this project.

## Automatic tab names

The `nook` layout copies the current Herdr `main` layout and uses the custom `nook-tabs` mod. Select `nook` in the layout picker after installation. For an unnamed tab, the bar chooses the first agent pane, otherwise the first non-shell terminal, otherwise the first terminal, in pane order. It displays the agent's terminal title when available, otherwise the program name, then the current directory's last component, and finally the tab number. A manually named tab always keeps its name; clearing it returns to automatic display. The inferred name is not saved or sent to other clients. Pane focus changes do not change which split supplies the name.

After changing the mod or layout, rerun the install command (use `--force` only after reviewing destination differences), then check `herdr-app check ~/.config/herdr-app/mods/nook-tabs`, `herdr-app status`, and the displayed tab bar. To return to Herdr's built-in interface, select the `main` layout. The custom layout is a snapshot; to pick up later upstream layout changes, compare it with `main` and carry them over while retaining the `nook-tabs` reference.

## Spaces and editors

The `nook` layout also uses `nook-spaces`, based on the installed built-in Spaces mod. Expanded rows show the space name, agent status, Git branch, changed-file count, ahead/behind counts and multiple-tab count. Non-repositories show their current folder; `Git unknown` means the result is pending or unavailable, not a clean repository. Git data follows the built-in refresh strategy and can lag behind external edits. The first available terminal folder supplies the Git and editor location. Lucide icons supplied by Herdr are selected consistently from each space ID.

Expanded machine cards show CPU usage and used / total memory, refreshed every 10 seconds. CPU is sampled over approximately one second. On Linux, used memory is total minus `MemAvailable`; on macOS it is active, wired, and compressed pages. Values use GiB (displayed as GB). Offline machines and unsupported systems show unavailable. The row is hidden when the machine or sidebar is collapsed. After installation, verify both local and connected remote machines in the expanded Spaces sidebar and check that unavailable machines do not show old readings.

Hover over an expanded Space and click its pin to keep it at the top of its machine; click the highlighted pin again to unpin it. Pins are stored in Herdr shared state on this client and survive layout changes and restarts. Pinning changes the display order without changing the saved Space order; drag within the pinned or unpinned group to reorder. A worktree pinned separately from its main checkout is displayed as an independent row. To verify after installing, pin and unpin Spaces on each machine, drag within a group, and confirm the original group position returns after unpinning.

The package-pen icon opens the current folder in an installed VS Code or Zed on macOS. For a remote space, the picker looks up the machine's SSH target in `hc machine ls` and passes the remote path to the selected editor. Both editors must be able to SSH to that target independently of Herdr; VS Code also needs its Remote - SSH extension. The editors may prompt for authentication or install their remote server. SSH config aliases are supported. Custom `hc machine add --via` transports are not supported; use a normal SSH config alias. For VS Code, configure a nonstandard port in SSH config and add the machine with that alias. An absolute remote folder is required. An accepted launch does not mean the editor has connected successfully: check the editor window for connection errors.

The icon is from [Lucide](https://lucide.dev/) (ISC license; see Herdr's `icons/LICENSE-Lucide.txt`).

After updating, review `python3 scripts/install.py --dry-run`, install (use `--force` only after reviewing conflicts), and run `herdr-app check` for both `mods/nook-spaces` and `mods/nook-editor`. Check `herdr-app status` and exercise the picker in the `nook` layout. The layout and mods are snapshots of built-in code; compare them with Herdr's updates before incorporating upstream changes.

Right-click a Space and choose **Change icon** to browse the icon grid. The picker reads SVGs from Herdr's `mods/workspace-chrome` and `icons` directories each time it opens. Enter part of a name to filter; Enter selects an exact match or the sole result. Hover an icon to see its name and source. **Random** draws a preview from the current results. Use **Draw again** to redraw and **Use icon** to save the preview; closing the picker leaves the saved icon unchanged. **Automatic** restores the default. The selection is saved per Space in this client's shared state and persists across layout changes and restarts. Nested worktrees keep their branch icon until a custom icon is chosen; the compact sidebar continues to display numbers. Icons are drawn in the Space color.

After changes, review the installation dry run and destination differences, install the updated files, run `herdr-app check` on `nook-spaces`, `nook-space-menu`, and `nook-icon-picker`, and check `herdr-app status`. In the `nook` layout, check icon browsing, search, random preview, redraw, saving and Automatic, including a nested worktree. Verify persistence after restarting Herdr and confirm existing rename, worktree and close actions.

## Render performance

`nook-spaces` shares one snapshot of panes, agents, and machine layouts across rows on each render, counting agents by Space once. The snapshot is rebuilt on the next render, so live title, status, folder, and connection changes remain visible. Color assignment maintains running usage counts instead of rescanning every assigned color for each candidate. `nook-tabs` selects each tab's preferred terminal in one pass over panes, preserving the first agent, then first non-shell terminal, then first terminal in model order. Manual names keep priority.

Run `node tests/render-performance.cjs` from the project root for render regression checks with a minimal GPUI mock. It covers tab selection, live updates, agent counts, balanced colors, and native collection read counts for 1 and 100 Spaces. This checks JavaScript behavior and call counts, not native layout, frame rate, or CPU usage. Also run `herdr-app check mods/nook-spaces` and `herdr-app check mods/nook-tabs`.

These commands check project sources; they do not install them. To apply an update, review the installation dry run and destination differences using the installation steps above. After installing, check `herdr-app status`, inspect a `herdr-app shot` capture, and exercise tab titles, Space selection, pinning, dragging, editor launch, and remote machine status in the running `nook` layout. Native interaction and performance measurements require that separate runtime verification.

## Files context menu

The `nook` layout uses `nook-files`, a snapshot of Herdr's Files panel. The file tree stays above a read-only preview; select a file to show it below and drag the divider to resize the two areas; its last ratio is restored when the panel is reopened. Markdown files offer Code and Preview modes; the last chosen mode is remembered for this panel across files and app restarts. Both modes use the same bounded file content. Right-click a file or folder to open it in Zed or VS Code, or copy its path relative to the folder shown by Files (the focused terminal's current folder). The menu supports arrow keys, Enter and Escape. Opening uses the local macOS editor; remote paths use the same SSH target restrictions described above for Spaces. The editor may still need to authenticate or establish its remote connection.

After updating, run `python3 scripts/install.py --dry-run`, review any destination differences, and install with `python3 scripts/install.py` (add `--force` only for reviewed conflicts). Run `herdr-app check mods/nook-files` and `herdr-app check mods/nook-files-menu`, then check `herdr-app status`. In the `nook` layout verify the menu on nested files and folders, clipboard contents, both editor launches, remote paths where applicable, file preview, split resizing, and folder expansion. Compare the snapshot with Herdr's built-in Files mod when incorporating upstream updates.
