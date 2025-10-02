#!/usr/bin/env python3
"""
Simple HTTP server to test the refactored task app
"""
import json
import os
import time
import random
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
        
        # Handle complete task endpoint
        if path.startswith('/api/task/') and path.endswith('/complete'):
            if user_type == 'public':
                self.send_json_response({'error': 'Public users cannot complete tasks'}, 403)
                return
            
            # Extract task ID from path like /api/task/test_friend_123/complete
            path_parts = path.split('/')
            if len(path_parts) != 5:
                self.send_json_response({'error': 'Invalid path'}, 400)
                return
            
            task_id = path_parts[3]
            
            try:
                tasks_file = f'task/data/{user_type}/tasks.json'
                with open(tasks_file, 'r') as f:
                    tasks_data = json.load(f)
                
                # Find and complete the task
                task_found = False
                completed_task = None
                from datetime import datetime, timezone
                current_time = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                
                # Find the task and prepare for removal
                for i, task in enumerate(tasks_data['tasks']):
                    if task['id'] == task_id:
                        # Update task state for stats
                        task['state'] = 'Completed'
                        task['closedAt'] = current_time
                        task['updatedAt'] = current_time
                        completed_task = task.copy()
                        # Remove from active tasks
                        tasks_data['tasks'].pop(i)
                        task_found = True
                        break
                
                if not task_found:
                    self.send_json_response({'error': 'Task not found'}, 404)
                    return
                
                # Save updated data
                tasks_data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                with open(tasks_file, 'w') as f:
                    json.dump(tasks_data, f, indent=2)
                
                # Update stats with completed task data
                self.update_stats(user_type, 'completed', task_id, completed_task)
                
                self.send_json_response({'ok': True, 'message': f'Task {task_id} completed by {user_type}'})
                
            except Exception as e:
                print(f"Error completing task: {e}")
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
            
            # Create new task with current UTC timestamp
            from datetime import datetime, timezone
            
            # Read existing tasks first to ensure ID uniqueness
            tasks_file = f'task/data/{user_type}/tasks.json'
            with open(tasks_file, 'r') as f:
                tasks_data = json.load(f)
            
            # Generate unique ID with microsecond precision + random suffix
            existing_ids = {task['id'] for task in tasks_data['tasks']}
            unique_id = None
            max_attempts = 10
            
            for _ in range(max_attempts):
                timestamp_us = int(time.time() * 1000000)  # microseconds for uniqueness
                random_suffix = random.randint(1000, 9999)
                candidate_id = f'test_{user_type}_{timestamp_us}_{random_suffix}'
                if candidate_id not in existing_ids:
                    unique_id = candidate_id
                    break
                time.sleep(0.001)  # Small delay before retry
            
            if not unique_id:
                self.send_json_response({'error': 'Failed to generate unique ID'}, 500)
                return
            
            task = {
                'id': unique_id,
                'title': data.get('title', ''), 
                'tag': data.get('tag'),
                'state': 'Active',
                'createdAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }
            
            # Actually save the task to the JSON file
            try:
                # Add new task to the beginning of the list (tasks_data already loaded above)
                tasks_data['tasks'].insert(0, task)
                tasks_data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                
                # Save back to file
                with open(tasks_file, 'w') as f:
                    json.dump(tasks_data, f, indent=2)
                
                # Update stats
                self.update_stats(user_type, 'created', task['id'])
                
                self.send_json_response({'ok': True, 'id': task['id']})
            except Exception as e:
                self.send_json_response({'error': str(e)}, 500)
        else:
            self.send_error(404)
    
    def handle_api_patch(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type == 'public':
            self.send_json_response({'error': 'Public users cannot modify tasks'}, 403)
            return
        
        # Extract task ID from path like /api/task/test_friend_123
        path_parts = path.split('/')
        if len(path_parts) != 4 or path_parts[1] != 'api' or path_parts[2] != 'task':
            self.send_json_response({'error': 'Invalid path'}, 400)
            return
        
        task_id = path_parts[3]
        
        # Read request body
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        patch_data = json.loads(post_data.decode('utf-8'))
        
        # Update the task in the JSON file
        try:
            tasks_file = f'task/data/{user_type}/tasks.json'
            with open(tasks_file, 'r') as f:
                tasks_data = json.load(f)
            
            # Find and update the task
            task_found = False
            for task in tasks_data['tasks']:
                if task['id'] == task_id:
                    # Update only the provided fields
                    for key, value in patch_data.items():
                        task[key] = value
                    task_found = True
                    break
            
            if not task_found:
                self.send_json_response({'error': 'Task not found'}, 404)
                return
            
            # Save updated data
            from datetime import datetime, timezone
            tasks_data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            with open(tasks_file, 'w') as f:
                json.dump(tasks_data, f, indent=2)
            
            # Update stats
            self.update_stats(user_type, 'edited', task_id)
            
            self.send_json_response({'ok': True, 'message': f'Task {task_id} updated by {user_type}'})
            
        except Exception as e:
            print(f"Error updating task: {e}")
            self.send_json_response({'error': str(e)}, 500)
    
    def handle_api_delete(self, path):
        user_type = self.headers.get('X-User-Type', 'public')
        
        if user_type == 'public':
            self.send_json_response({'error': 'Public users cannot delete tasks'}, 403)
            return
        
        # Extract task ID from path like /api/task/test_friend_123
        path_parts = path.split('/')
        if len(path_parts) != 4 or path_parts[1] != 'api' or path_parts[2] != 'task':
            self.send_json_response({'error': 'Invalid path'}, 400)
            return
        
        task_id = path_parts[3]
        
        # Mark the task as deleted
        try:
            tasks_file = f'task/data/{user_type}/tasks.json'
            with open(tasks_file, 'r') as f:
                tasks_data = json.load(f)
            
            # Find and delete the task
            task_found = False
            deleted_task = None
            from datetime import datetime, timezone
            current_time = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            
            # Find the task and prepare for removal
            for i, task in enumerate(tasks_data['tasks']):
                if task['id'] == task_id:
                    # Update task state for stats
                    task['state'] = 'Deleted'
                    task['closedAt'] = current_time
                    task['updatedAt'] = current_time
                    deleted_task = task.copy()
                    # Remove from active tasks
                    tasks_data['tasks'].pop(i)
                    task_found = True
                    break
            
            if not task_found:
                self.send_json_response({'error': 'Task not found'}, 404)
                return
            
            # Save updated data
            tasks_data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            with open(tasks_file, 'w') as f:
                json.dump(tasks_data, f, indent=2)
            
            # Update stats with deleted task data
            self.update_stats(user_type, 'deleted', task_id, deleted_task)
            
            self.send_json_response({'ok': True, 'message': f'Task {task_id} deleted by {user_type}'})
            
        except Exception as e:
            print(f"Error deleting task: {e}")
            self.send_json_response({'error': str(e)}, 500)

    def serve_json_file(self, filename):
        try:
            with open(filename, 'r') as f:
                data = json.load(f)
            self.send_json_response(data)
        except FileNotFoundError:
            self.send_error(404)
        except json.JSONDecodeError:
            self.send_error(500)

    def update_stats(self, user_type, event, task_id=None, task_data=None):
        """Update stats.json with task events and graveyard"""
        try:
            stats_file = f'task/data/{user_type}/stats.json'
            tasks_file = f'task/data/{user_type}/tasks.json'
            
            # Load existing stats
            try:
                with open(stats_file, 'r') as f:
                    stats_data = json.load(f)
            except FileNotFoundError:
                # Create new stats file
                stats_data = {
                    "version": 2,
                    "updatedAt": "",
                    "counters": {"created": 0, "completed": 0, "edited": 0, "deleted": 0},
                    "timeline": [],
                    "tasks": {}
                }
            
            # Update counters with correct event names
            if event in stats_data['counters']:
                stats_data['counters'][event] += 1
            
            # Add to timeline
            from datetime import datetime, timezone
            current_time = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            timeline_entry = {
                "t": current_time,
                "event": event
            }
            if task_id:
                timeline_entry["id"] = task_id
            
            stats_data['timeline'].append(timeline_entry)
            stats_data['updatedAt'] = current_time
            
            # Update graveyard - no need to read tasks file for completed/deleted tasks
            # They will be passed directly via the task_data parameter
            
            # Save stats
            with open(stats_file, 'w') as f:
                json.dump(stats_data, f, indent=2)
                
        except Exception as e:
            print(f"Error updating stats: {e}")
    
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