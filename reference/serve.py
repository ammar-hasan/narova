#!/usr/bin/env python3
"""Tiny static server WITH HTTP Range support (so video seeking works). Threaded."""
import http.server, socketserver, os, re, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()  # dirs / listings / 404
        size = os.path.getsize(path)
        ctype = self.guess_type(path)
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            start = int(m.group(1)) if m and m.group(1) else 0
            end = int(m.group(2)) if m and m.group(2) else size - 1
            end = min(end, size - 1)
            if start > end:
                self.send_error(416); return
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start); left = length
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk: break
                    try: self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError): break
                    left -= len(chunk)
        else:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(path, "rb") as f:
                try: self.copyfile(f, self.wfile)
                except (BrokenPipeError, ConnectionResetError): pass

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"serving {os.getcwd()} on 0.0.0.0:{PORT}", flush=True)
Server(("0.0.0.0", PORT), H).serve_forever()
