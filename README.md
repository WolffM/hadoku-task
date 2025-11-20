# Hadoku Task Manager

**A minimalist, portable task tracking micro-frontend**

Live at: https://hadoku.me/task/

Fast, focused task management with tags, filtering, and multi-user support. Built as a reusable micro-frontend with framework-agnostic API handlers. Perfect for embedding in larger applications or using standalone.

---

## 📱 Mobile App (Android)

Native Android app available! Built with Capacitor WebView wrapper.

**Quick Download:**

- 📥 [Latest APK](https://github.com/WolffM/hadoku-task-mobile/releases/latest/download/hadoku-task.apk)
- 🔄 **Obtainium**: [Install Obtainium](https://github.com/ImranR98/Obtainium/releases/latest), then add URL: `https://github.com/WolffM/hadoku-task-mobile`

**Repository:** [hadoku-task-mobile](https://github.com/WolffM/hadoku-task-mobile)

---

## ✨ Features

- ⚡ **Quick Task Entry** - Type and press Enter
- 🏷️ **Tag Support** - Organize with `#tags`
- 🔍 **Smart Filtering** - Filter by tag or view all
- 🎯 **Drag & Drop** - Reorder tasks and move between boards
- 🎨 **7 Themes** - Light, Dark, Strawberry, Ocean, Cyberpunk, Coffee, Lavender
- 📋 **Multi-Board** - Organize tasks across multiple boards
- ⚡ **Optimistic Updates** - Instant UI response with background sync
- 👥 **Multi-User** - Public (localStorage), Friend/Admin (server sync)
- 🔌 **Framework Agnostic** - Pure handlers work with any backend

---

## 🚀 Quick Start

### Install and Run

```bash
npm install
npm run dev
# Open http://localhost:5173?userType=public
```

### Build for Production

```bash
npm run build:all
```

**Output:**

- Client: `dist/index.js` (~22KB gzipped), `dist/style.css` (~7KB gzipped)
- Handlers: `dist/server/` (TypeScript compiled to JavaScript)

---

## 📦 Installation

### As an NPM Package

```bash
npm install @wolffm/task
```

### Basic Integration

**Client-side:**

```javascript
import { mount } from '@wolffm/task/frontend'
import '@wolffm/task/style.css'

mount(document.getElementById('app'), {
  userType: 'public',
  sessionId: 'session-123'
})
```

**Server-side (framework-agnostic):**

```typescript
import { TaskHandlers, TaskStorage } from '@wolffm/task/api'

// Implement storage for your environment (KV, filesystem, database, etc.)
const storage: TaskStorage = {
  getTasks: async userType => {
    /* your implementation */
  },
  saveTasks: async (userType, tasks) => {
    /* your implementation */
  },
  getStats: async userType => {
    /* your implementation */
  },
  saveStats: async (userType, stats) => {
    /* your implementation */
  }
}

// Use handlers with any framework (Express, Hono, Cloudflare Workers, etc.)
const tasks = await TaskHandlers.getTasks(storage, auth)
const newTask = await TaskHandlers.createTask(storage, auth, { title: 'Task' })
```

---

## 💡 Usage

### Creating Tasks

```
Buy groceries [Enter]                    # Plain task
Buy groceries #home [Enter]              # With tag
Fix bug #high-priority [Enter]           # Tagged task
```

### Task Actions

- **✓** Mark complete
- **×** Delete task
- **✎** Edit title
- **+** Add tag
- **Drag** Reorder or move between boards

### Themes

Choose from 7 carefully crafted themes via the theme picker (top-right):

- **☼ Light** - Clean blue and white
- **☽ Dark** - Sophisticated midnight
- **❖ Strawberry** - Sweet pink tones
- **≈ Ocean** - Deep sea blues
- **◆ Cyberpunk** - Neon dystopia
- **◉ Coffee** - Rich espresso
- **✿ Lavender** - Soft purple

---

## 📚 Documentation

| Document                                    | Purpose                                      | Audience                            |
| ------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | System design, patterns, technical decisions | Developers integrating or extending |
| **[API.md](docs/API.md)**                   | Complete endpoint reference                  | Backend implementers                |
| **[CHANGELOG.md](docs/CHANGELOG.md)**       | Version history and changes                  | All users                           |
| **[CONTRIBUTING.md](CONTRIBUTING.md)**      | Contribution guidelines                      | Contributors                        |

### Quick Links

- **Getting Started**: You're reading it! (README.md)
- **How it works**: [Architecture Overview](docs/ARCHITECTURE.md#overview)
- **Security model**: [Authentication & Security](docs/ARCHITECTURE.md#security--authentication)
- **API endpoints**: [Complete API Reference](docs/API.md)
- **Add features**: [Contributing Guide](CONTRIBUTING.md)

---

## 🏗️ Architecture Highlights

### Universal Adapter Pattern

This package separates pure business logic from framework-specific code:

```typescript
// Handlers are pure functions - work with ANY framework
await TaskHandlers.getTasks(storage, auth)
await TaskHandlers.createTask(storage, auth, input)
```

**Deployment flexibility:**

- ✅ Cloudflare Workers (KV storage)
- ✅ Node.js + Express (filesystem storage)
- ✅ Any framework that can call JavaScript functions

### Client Architecture

- React-based UI with optimistic updates
- All user types use localStorage for instant feedback
- Non-public users sync to server in background
- 7 complete themes with CSS custom properties

**See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design documentation.**

---

## 🔐 Security & Authentication

**This micro-frontend delegates authentication to the parent application.**

The task app:

- ✅ Does NOT handle credentials or passwords
- ✅ Receives `userType` and `sessionId` from parent
- ✅ Uses these for storage namespacing only

Your parent app must:

- ✅ Handle user login/logout
- ✅ Validate authentication keys
- ✅ Provide correct `userType` and `sessionId`
- ✅ Secure API endpoints

**See [ARCHITECTURE.md - Security](docs/ARCHITECTURE.md#security--authentication) for complete security model.**

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development workflow
- Code style guidelines
- How to add features
- Pull request process

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Web Repository**: https://github.com/WolffM/hadoku-task
- **Mobile Repository**: https://github.com/WolffM/hadoku-task-mobile
- **Example Deployment**: [hadoku.me/task](https://hadoku.me/task)
- **NPM Package**: `@wolffm/task`
- **Android APK**: [Latest Release](https://github.com/WolffM/hadoku-task-mobile/releases/latest)

---

**Author**: WolffM
