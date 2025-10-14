# @hadoku/task - Documentation

This package provides a multi-board task management system with pure framework-agnostic handlers.

## 📚 Documentation

### **For Parent Implementers**
- **[Parent API Reference](docs/PARENT_API_REFERENCE.md)** - 30-second cheat sheet for integrating handlers into your API worker

### **For Developers**
- **[README.md](README.md)** - Package overview and setup

## 🚀 Quick Start

```typescript
import { TaskHandlers, type Storage, type AuthContext } from '@wolffm/task/api'

// Implement storage interface
const storage: Storage = {
  getTasks: async (userType, userId, boardId) => { /* ... */ },
  saveTasks: async (userType, userId, boardId, tasks) => { /* ... */ },
  // ... see PARENT_API_REFERENCE.md for complete interface
}

// Create auth context
const auth: AuthContext = { userType: 'friend', userId: 'user123' }

// Call handlers
const result = await TaskHandlers.createTask(storage, auth, {
  title: 'New task',
  tag: 'urgent'
}, 'main')
```

## 📦 Package Contents

- `dist/server/` - Handler exports and types
- `dist/index.js` - Frontend component bundle
- `dist/style.css` - Frontend styles
- `docs/` - Integration documentation

## 🔗 Exports

```typescript
// Business logic handlers
import { TaskHandlers } from '@wolffm/task/api'

// Frontend component
import { mount } from '@wolffm/task/frontend'
import '@wolffm/task/style.css'
```

---

**Version:** 2.2.28  
**License:** ISC  
**Repository:** https://github.com/WolffM/hadoku-task
