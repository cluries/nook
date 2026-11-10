#!/usr/bin/env python3
"""Install Nook files into a Herdr App home without removing existing files."""

import argparse
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
# Herdr writes these into a mod folder when it loads or checks it; they are not
# project sources.
GENERATED = {".gitkeep", "gpui-kit.d.ts", "jsconfig.json"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app")).expanduser(), help="Herdr App home (default: HERDR_APP_HOME or ~/.config/herdr-app)")
    parser.add_argument("--force", action="store_true", help="overwrite files that differ")
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    home = args.home.expanduser()
    files = []
    for category in ("themes", "layouts", "mods"):
        for source in sorted((ROOT / category).rglob("*")):
            if source.is_file() and source.name not in GENERATED:
                files.append((source, home / source.relative_to(ROOT)))

    changes = []
    conflicts = []
    for source, target in files:
        if target.is_symlink() or (target.exists() and not target.is_file()):
            conflicts.append((target, "not a regular file"))
        elif target.exists() and source.read_bytes() == target.read_bytes():
            print(f"unchanged {target}")
        else:
            changes.append((source, target))
            if target.exists() and not args.force:
                conflicts.append((target, "different existing file; use --force to overwrite"))
    if conflicts:
        for target, reason in conflicts:
            print(f"conflict  {target}: {reason}", file=sys.stderr)
        return 1
    for source, target in changes:
        print(f"{'would install' if args.dry_run else 'install'} {target}")
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
