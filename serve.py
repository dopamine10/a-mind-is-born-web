# Local dev server for "A Mind Is Born" that DISABLES caching, so editing a module
# (sid-hermit.js, c64.js, index.html, ...) always takes effect on the next reload — no stale
# ES-module cache, which has repeatedly masked changes during development.
import sys, webbrowser, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a):  # keep the console quiet
        pass

threading.Timer(1.0, lambda: webbrowser.open(f'http://localhost:{PORT}/index.html')).start()
print(f'Serving (no-cache) at http://localhost:{PORT}/   —   Ctrl+C to stop')
try:
    ThreadingHTTPServer(('', PORT), NoCache).serve_forever()
except KeyboardInterrupt:
    pass
