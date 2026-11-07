#!/usr/bin/env python3
"""Local dev server: like `python3 -m http.server`, but tells the browser to revalidate every file,
so edits to analyze.js / separator.js reach the page and its worker without stale module caches.
usage: python3 serve.py [port]   (default 8642, localhost only)"""
import http.server, sys
from functools import partial
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # cache, but always check Last-Modified (cheap 304s)
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
handler = partial(NoCache, directory=str(Path(__file__).parent))
print(f'Lockstep on http://127.0.0.1:{port}/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
