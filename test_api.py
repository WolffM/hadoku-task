#!/usr/bin/env python3
"""
Simple test script to verify the API endpoints work with new URL pattern
"""
import requests
import json

BASE_URL = "http://localhost:3001/task/api"

def test_get_tasks():
    """Test GET /task/api"""
    print("Testing GET /task/api...")
    response = requests.get(f"{BASE_URL}?userType=public")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ GET /task/api works!\n")

def test_create_task():
    """Test POST /task/api"""
    print("Testing POST /task/api...")
    response = requests.post(
        BASE_URL,
        headers={
            "Content-Type": "application/json",
            "X-User-Type": "public"
        },
        json={"title": "Test task", "tag": "test"}
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    assert response.status_code == 200
    print("✅ POST /task/api works!\n")
    return data.get("id")

def test_patch_task(task_id):
    """Test PATCH /task/api/:id"""
    print(f"Testing PATCH /task/api/{task_id}...")
    response = requests.patch(
        f"{BASE_URL}/{task_id}",
        headers={
            "Content-Type": "application/json",
            "X-User-Type": "public"
        },
        json={"title": "Updated test task", "tag": "updated"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ PATCH /task/api/:id works!\n")

def test_complete_task(task_id):
    """Test POST /task/api/:id/complete"""
    print(f"Testing POST /task/api/{task_id}/complete...")
    response = requests.post(
        f"{BASE_URL}/{task_id}/complete",
        headers={"X-User-Type": "public"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ POST /task/api/:id/complete works!\n")

def test_delete_task(task_id):
    """Test DELETE /task/api/:id"""
    print(f"Testing DELETE /task/api/{task_id}...")
    response = requests.delete(
        f"{BASE_URL}/{task_id}",
        headers={"X-User-Type": "public"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ DELETE /task/api/:id works!\n")

def test_clear_tasks():
    """Test POST /task/api/clear"""
    print("Testing POST /task/api/clear...")
    response = requests.post(
        f"{BASE_URL}/clear",
        headers={"X-User-Type": "public"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ POST /task/api/clear works!\n")

def test_get_stats():
    """Test GET /task/api/stats"""
    print("Testing GET /task/api/stats...")
    response = requests.get(f"{BASE_URL}/stats?userType=public")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ GET /task/api/stats works!\n")

if __name__ == "__main__":
    print("=" * 60)
    print("Testing API Endpoints with New URL Pattern (/task/api)")
    print("=" * 60 + "\n")
    
    try:
        # Test all endpoints
        test_get_tasks()
        task_id = test_create_task()
        test_get_stats()
        test_patch_task(task_id)
        
        # Create another task for delete test
        task_id2 = test_create_task()
        test_delete_task(task_id2)
        
        # Complete the first task
        test_complete_task(task_id)
        
        # Clear all tasks
        test_clear_tasks()
        
        print("=" * 60)
        print("✅ ALL TESTS PASSED!")
        print("=" * 60)
        
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to server.")
        print("Make sure the test server is running: npm run test:server")
    except AssertionError as e:
        print(f"❌ Test failed: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
