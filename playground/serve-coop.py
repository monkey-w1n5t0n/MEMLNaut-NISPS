#!/usr/bin/env python3
"""HTTP server with COOP/COEP headers for SharedArrayBuffer support."""
import http.server
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class COOPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
with http.server.HTTPServer(('', PORT), COOPHandler) as httpd:
    print(f'Serving playground at http://localhost:{PORT} (COOP/COEP enabled)')
    httpd.serve_forever()
