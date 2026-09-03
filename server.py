#!/usr/bin/env python3
"""Busca Sem Filtro — estático + relay same-origin p/ OpenCode Zen.

Por que existe: o endpoint https://opencode.ai/zen NÃO envia
`Access-Control-Allow-Origin`, então o navegador bloqueia qualquer fetch
direto (CORS). Este relay repassa server-side e devolve com ACAO:*.

Uso:  python3 server.py [porta]   # default 8080
      http://localhost:8080

Rotas:
  GET  /api/zen/models     -> GET https://opencode.ai/zen/v1/models (público)
  POST /api/zen/chat       -> POST https://opencode.ai/zen/v1/chat/completions
  POST /api/zen/responses  -> POST https://opencode.ai/zen/v1/responses
  *    resto               -> arquivos estáticos do diretório

A key Zen vai no header Authorization (Bearer) de cada POST e é repassada
como está — nunca é logada nem gravada em disco.
Só stdlib. Sem dependências.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

BASE = "https://opencode.ai/zen/v1"
UPSTREAM_TIMEOUT = 120

ROUTES = {
    ("/api/zen/models", "GET"): (BASE + "/models", None),
    ("/api/zen/chat", "POST"): (BASE + "/chat/completions", None),
    ("/api/zen/responses", "POST"): (BASE + "/responses", None),
}


class Handler(SimpleHTTPRequestHandler):
    server_version = "BSF-Relay/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Zen-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _relay(self, upstream):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            # Upstream (Cloudflare) barra assinaturas não-browser (erro 1010).
            "User-Agent": self.headers.get(
                "User-Agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            ),
            "Accept": "application/json",
        }
        auth = self.headers.get("Authorization") or self.headers.get("X-Zen-Key")
        if auth:
            headers["Authorization"] = auth if auth.startswith("Bearer ") else "Bearer " + auth
        req = urllib.request.Request(upstream, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as res:
                payload = res.read()
                self.send_response(res.status)
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/json"))
                self._cors()
                self.end_headers()
                self.wfile.write(payload)
                print(f"{self.command} {self.path} -> {res.status}", flush=True)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(payload)
            print(f"{self.command} {self.path} -> {e.code}", flush=True)
        except Exception as e:
            payload = json.dumps({"error": {"message": f"relay: {type(e).__name__}"}}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(payload)
            print(f"{self.command} {self.path} -> 502 {type(e).__name__}", flush=True)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        route = ROUTES.get((self.path, "GET"))
        if route:
            self._relay(route[0])
        else:
            super().do_GET()

    def do_POST(self):
        route = ROUTES.get((self.path, "POST"))
        if route:
            self._relay(route[0])
        else:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"not found"}}')

    def log_message(self, *args):
        pass  # log próprio acima; nada de headers/corpos (podem conter key)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Busca Sem Filtro em http://localhost:{port} (relay Zen em /api/zen/*)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
