# Hadoku Task Manager

**Guide:** [overview](docs/guide/index.md) · [features](docs/guide/features.md) · [contributing](docs/guide/contributing.md) · [history](docs/guide/history.md) · [trivia](docs/guide/trivia.md)

## A minimalist, portable task tracking micro-frontend

Live at: <https://hadoku.me/task/>

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

What each feature does and how to use it — tasks and boards, sharing,
calendar, automation boards, trackers, the theme editor and picker, MCP for
agents, and the Kate plugin — is in
[docs/guide/features.md](docs/guide/features.md).

---

## 🚀 Quick Start

### Install and Run

```bash
pnpm install
pnpm run dev
# Open http://localhost:5173?userType=public
```

### Test

```bash
pnpm run test:worker         # worker harnesses against a real SQLite D1
pnpm exec playwright test    # e2e; starts the real stack + vite on free ports
```

CI runs the same suites (plus typecheck, lint and lint:css); see
[contributing.md](docs/guide/contributing.md#tests-and-gates) for why a push
to `main` is detection there, not prevention.

### Build for Production

```bash
pnpm run build:all
```

**Output:**

- Client: `dist/index.js` (~54KB gzipped), `dist/style.css` (~15KB gzipped)
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

## 📚 Documentation

| Document                                    | Purpose                                       | Audience                            |
| ------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | System design, patterns, technical decisions  | Developers integrating or extending |
| **[API.md](docs/API.md)**                   | Complete endpoint reference                   | Backend implementers                |
| **[MCP.md](docs/MCP.md)**                   | Remote MCP server for agents (tasks/calendar) | Agents & integrators                |
| **[CHANGELOG.md](docs/CHANGELOG.md)**       | Version history and changes                   | All users                           |
| **[CONTRIBUTING.md](CONTRIBUTING.md)**      | Contribution guidelines                       | Contributors                        |

### Quick Links

- **Getting Started**: You're reading it! (README.md)
- **How it works**: [Architecture Overview](docs/ARCHITECTURE.md#overview)
- **Security model**: [Authentication & Security](docs/ARCHITECTURE.md#security--authentication)
- **API endpoints**: [Complete API Reference](docs/API.md)
- **Agents / MCP**: [MCP Server](docs/MCP.md)
- **Add features**: [Contributing Guide](CONTRIBUTING.md)

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

- **Web Repository**: <https://github.com/WolffM/hadoku-task>
- **Mobile Repository**: <https://github.com/WolffM/hadoku-task-mobile>
- **Example Deployment**: [hadoku.me/task](https://hadoku.me/task)
- **NPM Package**: `@wolffm/task`
- **Android APK**: [Latest Release](https://github.com/WolffM/hadoku-task-mobile/releases/latest)

---

**Author**: WolffM
