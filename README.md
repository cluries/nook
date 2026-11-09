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

The package-pen icon opens the current folder in an installed VS Code or Zed on macOS. For a remote space, the picker looks up the machine's SSH target in `hc machine ls` and passes the remote path to the selected editor. Both editors must be able to SSH to that target independently of Herdr; VS Code also needs its Remote - SSH extension. The editors may prompt for authentication or install their remote server. SSH config aliases are supported. Custom `hc machine add --via` transports are not supported; use a normal SSH config alias. For VS Code, configure a nonstandard port in SSH config and add the machine with that alias. An absolute remote folder is required. An accepted launch does not mean the editor has connected successfully: check the editor window for connection errors.

The icon is from [Lucide](https://lucide.dev/) (ISC license; see Herdr's `icons/LICENSE-Lucide.txt`).

After updating, review `python3 scripts/install.py --dry-run`, install (use `--force` only after reviewing conflicts), and run `herdr-app check` for both `mods/nook-spaces` and `mods/nook-editor`. Check `herdr-app status` and exercise the picker in the `nook` layout. The layout and mods are snapshots of built-in code; compare them with Herdr's updates before incorporating upstream changes.
