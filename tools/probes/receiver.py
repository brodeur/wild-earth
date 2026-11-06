import base64, re, sys, os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
OUT = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def _c(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS"); self.send_header("Access-Control-Allow-Headers", "*")
    def do_OPTIONS(self):
        self.send_response(204); self._c(); self.end_headers()
    def do_POST(self):
        q = parse_qs(urlparse(self.path).query); name = re.sub(r"[^a-z0-9_.-]", "_", (q.get("name") or ["x"])[0].lower())[:80]
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        data = base64.b64decode(body.split(",", 1)[1])
        p = os.path.join(OUT, name + ".jpg"); open(p, "wb").write(data)
        self.send_response(200); self._c(); self.end_headers(); self.wfile.write(f"{p} {len(data)}".encode())
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
