import fcntl
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from xml.parsers import expat

MAX_SVG_BYTES = 5 * 1024 * 1024
DEFAULT_SVG_WIDTH = 300
DEFAULT_SVG_HEIGHT = 150


def _length(value):
    # SVG width/height: unitless and px are usable; percentages and other units
    # fall back to the viewBox.
    if value is None:
        return None
    match = re.fullmatch(rb"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:px)?\s*", value)
    if not match:
        return None
    number = float(match.group(1))
    return number if math.isfinite(number) and number > 0 else None


def svg_size(data):
    if len(data) > MAX_SVG_BYTES:
        raise ValueError("SVG is too large to preview")
    parser = expat.ParserCreate(namespace_separator="}")
    attributes = None

    def start(name, attrs):
        nonlocal attributes
        if attributes is None:
            if name not in ("svg", "SVG", "http://www.w3.org/2000/svg}svg"):
                raise ValueError("SVG root element not found")
            attributes = {key.lower().encode(): value.encode() for key, value in attrs.items()}

    def reject_doctype(*_args):
        raise ValueError("SVG document types are not supported")

    parser.StartElementHandler = start
    parser.StartDoctypeDeclHandler = reject_doctype
    try:
        parser.Parse(data, True)
    except expat.ExpatError as error:
        raise ValueError("Invalid SVG XML") from error
    if attributes is None:
        raise ValueError("SVG root element not found")
    width, height = _length(attributes.get(b"width")), _length(attributes.get(b"height"))
    view_box = None
    if b"viewbox" in attributes:
        parts = re.split(rb"[\s,]+", attributes[b"viewbox"].strip())
        if len(parts) == 4:
            try:
                view_width, view_height = float(parts[2]), float(parts[3])
            except ValueError:
                pass
            else:
                if math.isfinite(view_width) and math.isfinite(view_height) and view_width > 0 and view_height > 0:
                    view_box = (view_width, view_height)
    if view_box:
        if width is None and height is None:
            width, height = view_box
        elif width is None:
            width = height * view_box[0] / view_box[1]
        elif height is None:
            height = width * view_box[1] / view_box[0]
    width = width if width is not None else DEFAULT_SVG_WIDTH
    height = height if height is not None else DEFAULT_SVG_HEIGHT
    return width, height


def main():
    source, app_home = sys.argv[1:]
    folder = os.path.join(app_home, "data", "nook-files-originals")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, ".lock"), "a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ext = os.path.splitext(source)[1].lower()
        with open(source, "rb") as original:
            data = original.read(MAX_SVG_BYTES + 1) if ext == ".svg" else original.read()
        if ext == ".svg":
            width, height = svg_size(data)
        else:
            result = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", source], check=True, capture_output=True, text=True)
            dimensions = dict(line.strip().split(": ", 1) for line in result.stdout.splitlines() if ": " in line)
            width, height = int(dimensions["pixelWidth"]), int(dimensions["pixelHeight"])
        if width <= 0 or height <= 0:
            raise ValueError("Invalid image dimensions")
        name = hashlib.sha256(data).hexdigest() + ext
        dest = os.path.join(folder, name)
        if not os.path.exists(dest):
            fd, temporary = tempfile.mkstemp(prefix=".incoming-", dir=folder)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(data)
                os.replace(temporary, dest)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        os.utime(dest, None)
        # Restrict eviction to files created by this cache, including its old names.
        pattern = re.compile(r"(?:[0-9a-f]{64}|\d+-[a-z0-9]+)\.(?:png|jpe?g|gif|webp|bmp|svg)$")
        entries = [os.path.join(folder, n) for n in os.listdir(folder) if pattern.fullmatch(n) and n != name and os.path.isfile(os.path.join(folder, n))]
        entries.sort(key=lambda p: (os.stat(p).st_mtime_ns, p), reverse=True)
        for old in entries[15:]:
            os.unlink(old)
        print(json.dumps({"path": "data/nook-files-originals/" + name, "width": width, "height": height}))


if __name__ == "__main__":
    main()
