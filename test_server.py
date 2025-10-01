#!/usr/bin/env python3
"""
Simple HTTP server to test the refactored task app
"""
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading
import webbrowser

class TaskAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def do_GET(self):
        parsed_path = urlparse(self.path)
        
        # Handle API routes
        if parsed_path.path.startswith('/api/'):
            self.handle_api_get(parsed_path.path)
        else:
            # Serve static files
            super().do_GET()
    
    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path.startswith('/api/'):
            self.handle_api_post(parsed_path.path)
        else:
            self.send_error(404)
    
    def do_PATCH(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path.startswith('/api/'):
            self.handle_api_patch(parsed_path.path)
        else:
            self.send_error(404)
    
    def do_DELETE(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path.startswith('/api/'):
            self.handle_api_delete(parsed_path.path)
        else:
            self.send_error(404)

    def handle_api_get(self, path):
        if path == '/api/task':
            self.serve_json_file('task/data/tasks.json')
        elif path == '/api/stats':
            self.serve_json_file('task/data/stats.json')
        else:
            self.send_error(404)
    
    def handle_api_post(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type != 'admin':
            self.send_json_response({'error': 'Admin access required'}, 403)
            return
        
        if path == '/api/task':
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # Simulate creating a task
            task = {
                'id': f'test_{len(data.get("title", "task"))}',
                'title': data.get('title', ''),
                'tag': data.get('tag'),
                'project': data.get('project'),
                'createdAt': '2025-10-01T12:00:00Z'
            }
            
            self.send_json_response({'ok': True, 'id': task['id'], 'task': task})
        else:
            self.send_error(404)
    
    def handle_api_patch(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type != 'admin':
            self.send_json_response({'error': 'Admin access required'}, 403)
            return
            
        self.send_json_response({'ok': True, 'message': 'Task updated (simulated)'})
    
    def handle_api_delete(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type != 'admin':
            self.send_json_response({'error': 'Admin access required'}, 403)
            return
            
        self.send_json_response({'ok': True, 'message': 'Task deleted (simulated)'})

    def serve_json_file(self, filename):
        try:
            with open(filename, 'r') as f:
                data = json.load(f)
            self.send_json_response(data)
        except FileNotFoundError:
            self.send_error(404)
        except json.JSONDecodeError:
            self.send_error(500)

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-User-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-User-Type')
        self.end_headers()

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('localhost', port), TaskAppHandler)
    
    print(f"Starting server at http://localhost:{port}")
    print("Open http://localhost:8000/test.html to test the refactored app")
    
    # Open browser after a short delay
    def open_browser():
        import time
        time.sleep(1)
        webbrowser.open(f'http://localhost:{port}/test.html')
    
    threading.Thread(target=open_browser, daemon=True).start()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()