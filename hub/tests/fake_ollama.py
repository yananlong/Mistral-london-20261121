#!/usr/bin/env python3
"""Local, stdlib-only Ollama stand-in; records each POST as one JSON line."""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['ok', 'slow', 'error500', 'empty', 'badjson'], default='ok')
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, default=11434)
parser.add_argument('--port-file')
parser.add_argument('--record')
parser.add_argument('--response-file', help='Use this UTF-8 file as the answer body in ok/slow mode')
args = parser.parse_args()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/chat':
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if args.record:
            with open(args.record, 'a', encoding='utf-8') as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + '\n')
        if args.mode == 'slow':
            time.sleep(1)
        if args.mode == 'error500':
            self.send_error(500)
            return
        body = (b'not-json' if args.mode == 'badjson' else
                json.dumps({'message': {'content': '' if args.mode == 'empty' else
                                         Path(args.response_file).read_text(encoding='utf-8') if args.response_file else
                                         '1. Move to a safe place.'}}).encode())
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *values):
        pass


server = ThreadingHTTPServer((args.host, args.port), Handler)
if args.port_file:
    Path(args.port_file).write_text(str(server.server_port), encoding='utf-8')
print(f'http://{args.host}:{server.server_port}', flush=True)
server.serve_forever()
