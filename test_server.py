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
        from urllib.parse import parse_qs
        parsed = urlparse(self.path)
        query_params = parse_qs(parsed.query)
        user_type = query_params.get('userType', ['public'])[0]
        
        if parsed.path == '/api/task':
            self.serve_json_file(f'task/data/{user_type}/tasks.json')
        elif parsed.path == '/api/stats':
            self.serve_json_file(f'task/data/{user_type}/stats.json')
        else:
            self.send_error(404)
    
    def handle_api_post(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if path == '/api/task/clear':
            if user_type != 'public':
                self.send_json_response({'error': 'Only public users can clear tasks'}, 403)
                return
            
            # Clear public tasks
            try:
                with open('task/data/public/tasks.json', 'w') as f:
                    json.dump({
                        "version": 1,
                        "updatedAt": "2025-10-01T23:30:00.000000Z",
                        "tasks": []
                    }, f, indent=2)
                
                with open('task/data/public/stats.json', 'w') as f:
                    json.dump({
                        "version": 2,
                        "updatedAt": "2025-10-01T23:30:00.000000Z",
                        "counters": {"created": 0, "completed": 0, "edited": 0, "deleted": 0, "sessions": 0},
                        "timeline": [],
                        "tasks": {}
                    }, f, indent=2)
                
                self.send_json_response({'ok': True, 'message': 'Public tasks cleared'})
            except Exception as e:
                self.send_json_response({'error': str(e)}, 500)
            return
        
        if user_type == 'public':
            self.send_json_response({'error': 'Public users cannot create tasks'}, 403)
            return
        
        if path == '/api/task':
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # Simulate creating a task
            task = {
                'id': f'test_{user_type}_{len(data.get("title", "task"))}',
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
        
        if user_type == 'public':
            self.send_json_response({'error': 'Public users cannot modify tasks'}, 403)
            return
            
        self.send_json_response({'ok': True, 'message': f'Task updated by {user_type} (simulated)'})
    
    def handle_api_delete(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type == 'public':
            self.send_json_response({'error': 'Public users cannot delete tasks'}, 403)
            return
            
        self.send_json_response({'ok': True, 'message': f'Task deleted by {user_type} (simulated)'})

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