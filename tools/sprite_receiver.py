"""Dev-only receiver for the opening screen's sprite renders (client/tools/opening_sprites.html).

    .venv/bin/python tools/sprite_receiver.py            # listens on 127.0.0.1:8798

The render page POSTs each PNG to /save/<name>.png; it is written under client/assets/opening/_png/ and nowhere
else (the name is reduced to [a-z0-9_.-], no paths). POST /done converts every PNG there to WebP next to it
(client/assets/opening/<name>.webp, PIL, quality 90 with alpha; the wisp sheet at WISP_Q) and writes index.json from
the JSON body the page sends. Stdlib http.server plus PIL from the .venv; not part of the game or server.py.
"""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "client" / "assets" / "opening"
PNG = ROOT / "_png"
WISP_Q = 70


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204); self._cors(); self.end_headers()

    def _reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(n)
        if self.path.startswith("/save/"):
            name = re.sub(r"[^a-z0-9_.-]", "", self.path[len("/save/"):].lower())
            if not name.endswith(".png") or "/" in name or name.startswith("."):
                return self._reply(400, {"error": "bad name"})
            PNG.mkdir(parents=True, exist_ok=True)
            (PNG / name).write_bytes(data)
            return self._reply(200, {"saved": name, "bytes": len(data)})
        if self.path == "/done":
            index = json.loads(data or b"{}")
            sizes = {}
            for p in sorted(PNG.glob("*.png")):
                out = ROOT / (p.stem + ".webp")
                q = WISP_Q if p.stem == "wisp" else 90   # the wisp sheet's mist and motes cost the most: q70 keeps it under ~0.85 MB
                Image.open(p).save(out, "WEBP", quality=q, alpha_quality=q, method=6)
                sizes[out.name] = out.stat().st_size
            for k, v in (index.get("species") or {}).items():
                if v.get("file") in sizes:
                    v["bytes"] = sizes[v["file"]]
            if index.get("wisp", {}).get("file") in sizes:
                index["wisp"]["bytes"] = sizes[index["wisp"]["file"]]
            index["total_bytes"] = sum(sizes.values())
            (ROOT / "index.json").write_text(json.dumps(index, indent=1) + "\n")
            return self._reply(200, {"written": sizes, "total": index["total_bytes"]})
        self._reply(404, {"error": "unknown"})

    def log_message(self, fmt, *args):  # quieter
        print("receiver:", fmt % args, flush=True)


if __name__ == "__main__":
    print(f"sprite receiver on http://127.0.0.1:8798 -> {ROOT}", flush=True)
    HTTPServer(("127.0.0.1", 8798), Handler).serve_forever()
