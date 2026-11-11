#!/usr/bin/env python3
"""Checks SVG size parsing and the Files preview image cache."""

import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "mods" / "nook-files" / "image-cache.py"

spec = importlib.util.spec_from_file_location("nook_image_cache", SCRIPT)
image_cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image_cache)
svg_size = image_cache.svg_size

assert svg_size(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect/></svg>') == (320.0, 200.0)
assert svg_size(b'<svg width="120" height="80"><rect/></svg>') == (120.0, 80.0)
assert svg_size(b"<svg width='120px' height='80px'><rect/></svg>") == (120.0, 80.0)
assert svg_size(b'<SVG WIDTH="12" HEIGHT="8"></SVG>') == (12.0, 8.0)
assert svg_size(b'<svg width="100%" height="100%" viewBox="0 0 64 48"></svg>') == (64.0, 48.0)
assert svg_size(b'<svg width="10em" height="5em" viewBox="0,0,64,48"></svg>') == (64.0, 48.0)
assert svg_size(b'<svg width="160" viewBox="0 0 320 200"></svg>') == (160.0, 100.0)
assert svg_size(b'<svg height="100" viewBox="0 0 320 200"></svg>') == (160.0, 100.0)
assert svg_size(b'<svg viewBox="-5 -5 10 20"></svg>') == (10.0, 20.0)
assert svg_size(b"<svg></svg>") == (300.0, 150.0)
assert svg_size(b'<svg width="0" height="0"></svg>') == (300.0, 150.0)
assert svg_size(b'<svg viewBox="0 0 0 10"></svg>') == (300.0, 150.0)
assert svg_size(b'<?xml version="1.0"?><!-- <svg width="999" height="1"> --><svg width="20" height="10"/>') == (20.0, 10.0)
assert svg_size(b'<svg width="0.0001" height="1"/>') == (0.0001, 1.0)
for bad in (b"<html></html>", b"", b'<svg width="20" height="10"><broken>',
            b'<!DOCTYPE svg [<!ENTITY x "test">]><svg>&x;</svg>',
            b'<html><svg/></html>'):
    try:
        svg_size(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"accepted invalid SVG: {bad!r}")

def run(source, home):
    return subprocess.run([sys.executable, str(SCRIPT), str(source), str(home)], capture_output=True, text=True)

def cached(source, home):
    result = run(source, home)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)

pattern = re.compile(r"[0-9a-f]{64}\.svg$")

def entries(home):
    folder = home / "data" / "nook-files-originals"
    return sorted(path.name for path in folder.iterdir() if pattern.fullmatch(path.name))

with tempfile.TemporaryDirectory() as temporary:
    home = Path(temporary)
    sources = home / "sources"
    sources.mkdir()

    first = sources / "first.svg"
    first.write_text('<svg viewBox="0 0 24 12"><rect/></svg>', encoding="utf-8")
    info = cached(first, home)
    copied = home / info["path"]
    assert (info["width"], info["height"]) == (24.0, 12.0), info
    assert copied.read_bytes() == first.read_bytes()
    first_name = copied.name

    same = sources / "same.svg"
    same.write_text(first.read_text(encoding="utf-8"), encoding="utf-8")
    assert cached(same, home)["path"] == info["path"]

    upper = sources / "UPPER.SVG"
    upper.write_text('<svg width="8" height="6"></svg>', encoding="utf-8")
    assert cached(upper, home)["path"].endswith(".svg")

    for index in range(1, 17):
        source = sources / f"{index}.svg"
        source.write_text(f'<svg viewBox="0 0 {index + 1} {index + 2}"></svg>', encoding="utf-8")
        cached(source, home)
        time.sleep(0.02)

    remaining = entries(home)
    assert len(remaining) == 16, remaining
    assert first_name not in remaining, "the least recently used SVG was not evicted"

    malformed = sources / "malformed.svg"
    malformed.write_text('<svg width="20" height="10"><broken>', encoding="utf-8")
    assert run(malformed, home).returncode != 0

    oversized = sources / "oversized.svg"
    oversized.write_bytes(b"<svg>" + b" " * (5 * 1024 * 1024))
    assert run(oversized, home).returncode != 0

print("Image cache: SVG dimensions, copies, extension handling, limits and LRU eviction passed")
