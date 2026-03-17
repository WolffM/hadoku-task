#!/usr/bin/env python3
import os

EXCLUDED_DIRS = {"node_modules", ".git", "__pycache__", ".husky", "dist", os.path.join("task", "data")}
EXCLUDED_EXTS = {".d.ts", ".json"}

def find_repo_root(start_dir="."):
    """Walk upward until we find a .git directory or reach filesystem root."""
    current = os.path.abspath(start_dir)
    while current != os.path.dirname(current):
        if os.path.isdir(os.path.join(current, ".git")):
            return current
        current = os.path.dirname(current)
    return os.path.abspath(start_dir)

def count_lines(file_path):
    """Return number of lines in a text file; 0 if unreadable or binary."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0

def scan_repo(base_dir):
    results = []
    for root, dirs, files in os.walk(base_dir):
        # Skip unwanted directories
        dirs[:] = [
            d for d in dirs
            if not any(os.path.normpath(os.path.join(root, d)).endswith(ex) for ex in EXCLUDED_DIRS)
        ]
        for file in files:
            if any(file.endswith(ext) for ext in EXCLUDED_EXTS):
                continue
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, base_dir)
            loc = count_lines(file_path)
            try:
                size = os.path.getsize(file_path)
            except OSError:
                size = 0
            results.append((rel_path, loc, size))
    
    # Sort by lines descending
    results.sort(key=lambda x: x[1], reverse=True)
    return results

if __name__ == "__main__":
    repo_root = find_repo_root(".")
    print(f"Scanning from repo root: {repo_root}\n")
    results = scan_repo(repo_root)
    for rel_path, loc, size in results:
        print(f"{rel_path} - {loc} lines - {size} bytes")
