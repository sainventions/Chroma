"""Build chroma.zip (the installable extension, without dev/ files).

Run from anywhere:  python dev/build_zip.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["manifest.json", "background.js", "content.js", "README.md",
         "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"]

version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "chroma.zip"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(ROOT / f, "chroma/" + f)  # forward slashes, so it unzips cleanly everywhere
print(f"built {out.name} (v{version}, {len(FILES)} files)")
