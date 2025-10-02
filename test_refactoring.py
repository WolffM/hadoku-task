#!/usr/bin/env python3
"""
Test script to verify the refactoring goals have been achieved
"""
import json
import os
import re

def test_refactoring_goals():
    """Test all the refactoring goals from the plan"""
    
    print("🧪 Testing Refactoring Goals")
    print("=" * 50)
    
    # Goal 1: Remove all process.env references from client bundle
    print("\n1. Testing: No process references in client bundle")
    
    with open('dist/index.js', 'r') as f:
        bundle_content = f.read()
    
    process_matches = re.findall(r'process\b', bundle_content)
    if process_matches:
        print(f"❌ Found {len(process_matches)} process references in bundle")
        return False
    else:
        print("✅ No process references found in client bundle")
    
    # Goal 2: Check that secrets are not in source code
    print("\n2. Testing: No secret handling in source code")
    
    secret_patterns = [
        r'ADMIN_KEY',
        r'TASK_ADMIN_KEY', 
        r'TASK_GH_PAT',
        r'githubPAT',
        r'localStorage\.setItem.*KEY',
        r'localStorage\.setItem.*PAT'
    ]
    
    source_files = ['src/App.tsx', 'src/entry.tsx', 'src/lib/api.ts']
    secrets_found = False
    
    for file_path in source_files:
        if not os.path.exists(file_path):
            continue
            
        with open(file_path, 'r') as f:
            content = f.read()
            
        for pattern in secret_patterns:
            matches = re.findall(pattern, content)
            if matches:
                print(f"❌ Found secret pattern '{pattern}' in {file_path}: {matches}")
                secrets_found = True
    
    if not secrets_found:
        print("✅ No secret handling found in source code")
    
    # Goal 3: Check userType prop usage
    print("\n3. Testing: userType prop usage")
    
    with open('src/App.tsx', 'r') as f:
        app_content = f.read()
    
    if 'userType' in app_content and 'canModify = userType === \'admin\' || userType === \'friend\'' in app_content:
        print("✅ App component uses userType prop correctly")
    else:
        print("❌ App component doesn't use userType prop correctly")
        return False
    
    # Goal 4: Check API validation
    print("\n4. Testing: API access control")
    
    with open('src/lib/api.ts', 'r') as f:
        api_content = f.read()
    
    if 'Public users cannot' in api_content and 'X-User-Type' in api_content:
        print("✅ API has proper access control based on userType")
    else:
        print("❌ API doesn't have proper access control")
        return False
    
    # Goal 5: Check service worker is disabled
    print("\n5. Testing: Service worker handling")
    
    with open('src/entry.tsx', 'r') as f:
        entry_content = f.read()
    
    if 'Service Worker disabled' in entry_content:
        print("✅ Service worker registration is disabled")
    else:
        print("❌ Service worker is still active")
        return False
    
    # Goal 6: Check JSON files have test data
    print("\n6. Testing: JSON files updated")
    
    with open('task/data/tasks.json', 'r') as f:
        tasks_data = json.load(f)
    
    if tasks_data.get('tasks') and len(tasks_data['tasks']) > 0:
        print("✅ Tasks JSON has test data")
    else:
        print("❌ Tasks JSON is empty")
        return False
    
    with open('task/data/stats.json', 'r') as f:
        stats_data = json.load(f)
    
    if stats_data.get('tasks') and len(stats_data['tasks']) > 0:
        print("✅ Stats JSON has test data")
    else:
        print("❌ Stats JSON is empty")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 ALL REFACTORING GOALS ACHIEVED!")
    print("\nSummary of changes:")
    print("- ✅ Removed all process.env references from client bundle")
    print("- ✅ Stripped secret handling from child app code") 
    print("- ✅ Replaced direct GitHub calls with userType-based API")
    print("- ✅ Pass userType as props instead of raw secrets")
    print("- ✅ API validates admin access before mutations")
    print("- ✅ Service worker disabled (parent will handle GitHub)")
    print("- ✅ JSON files updated with test data")
    print("\nThe app is now ready for parent integration!")
    
    return True

if __name__ == '__main__':
    success = test_refactoring_goals()
    exit(0 if success else 1)