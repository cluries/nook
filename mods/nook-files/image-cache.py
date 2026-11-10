import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

source, app_home = sys.argv[1:]
folder = os.path.join(app_home, "data", "nook-files-originals")
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, ".lock"), "a+b") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with open(source, "rb") as original:
        data = original.read()
    ext = os.path.splitext(source)[1].lower()
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
    pattern = re.compile(r"(?:[0-9a-f]{64}|\d+-[a-z0-9]+)\.(?:png|jpe?g|gif|webp|bmp)$")
    entries = [os.path.join(folder, n) for n in os.listdir(folder) if pattern.fullmatch(n) and n != name and os.path.isfile(os.path.join(folder, n))]
    entries.sort(key=lambda p: (os.stat(p).st_mtime_ns, p), reverse=True)
    for old in entries[15:]:
        os.unlink(old)
    print(json.dumps({"path": "data/nook-files-originals/" + name, "width": width, "height": height}))
