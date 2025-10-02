#!/usr/bin/env python3
"""
Test script to simulate updating JSON files (like the refactored app would do via parent API)
"""
import json
import os
from datetime import datetime

def update_json_files():
    """Update tasks.json and stats.json with test data"""
    
    # Create test task
    test_task = {
        "id": "01JB2EXAMPLE123",
        "title": "Test task from refactored app",
        "tag": "refactor",
        "createdAt": datetime.utcnow().isoformat() + "Z"
    }
    
    # Update tasks.json
    tasks_file = "task/data/tasks.json"
    with open(tasks_file, 'r') as f:
        tasks_data = json.load(f)
    
    # Add test task if not already there
    if not any(task.get('id') == test_task['id'] for task in tasks_data.get('tasks', [])):
        tasks_data['tasks'].insert(0, test_task)
        tasks_data['updatedAt'] = datetime.utcnow().isoformat() + "Z"
        
        with open(tasks_file, 'w') as f:
            json.dump(tasks_data, f, indent=2)
        
        print(f"✅ Updated {tasks_file}")
    else:
        print(f"ℹ️  Test task already exists in {tasks_file}")
    
    # Update stats.json
    stats_file = "task/data/stats.json"
    with open(stats_file, 'r') as f:
        stats_data = json.load(f)
    
    # Update stats
    if test_task['id'] not in stats_data.get('tasks', {}):
        stats_data['counters']['created'] = stats_data['counters'].get('created', 0) + 1
        stats_data['timeline'].append({
            't': test_task['createdAt'],
            'event': 'create',
            'id': test_task['id']
        })
        stats_data['tasks'][test_task['id']] = {
            'id': test_task['id'],
            'title': test_task['title'],
            'tag': test_task['tag'],
            'createdAt': test_task['createdAt'],
            'updatedAt': None,
            'closedAt': None,
            'state': 'Active'
        }
        stats_data['updatedAt'] = datetime.utcnow().isoformat() + "Z"
        
        with open(stats_file, 'w') as f:
            json.dump(stats_data, f, indent=2)
        
        print(f"✅ Updated {stats_file}")
    else:
        print(f"ℹ️  Test task stats already exist in {stats_file}")

if __name__ == '__main__':
    print("🚀 Testing JSON file updates (simulating refactored app behavior)")
    update_json_files()
    print("✨ Done! Check the updated JSON files.")