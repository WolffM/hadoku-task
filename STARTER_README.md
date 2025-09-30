# Micro-Frontend Starter Package

This folder contains everything you need to create a new micro-frontend app for hadoku_site.

## 📦 What's Included

```
starter-templates/
├── .github/workflows/
│   └── (copy from ../generic-micro-frontend-workflow.yml)
├── src/
│   ├── entry.tsx           ✅ Required mount/unmount exports
│   ├── App.tsx             ✅ Sample app component
│   └── styles.css          ✅ Basic CSS
├── index.html              ✅ Local dev page
├── package.json            ✅ Dependencies & scripts
├── vite.config.ts          ✅ Library build config
├── tsconfig.json           ✅ TypeScript config
├── tsconfig.node.json      ✅ Vite config types
├── .gitignore              ✅ Standard ignores
└── README.md               ✅ Usage instructions
```

## 🚀 Quick Setup

### 1. Copy the starter files

```bash
# Create your new app repo
mkdir hadoku-myapp
cd hadoku-myapp

# Copy all starter files
cp -r /path/to/hadoku_site/docs/starter-templates/* .

# Copy the workflow
mkdir -p .github/workflows
cp /path/to/hadoku_site/docs/generic-micro-frontend-workflow.yml .github/workflows/build.yml
```

### 2. Customize for your app

**Replace all instances of `myapp` with your app name:**

- `vite.config.ts`: Line 6 `base: '/myapp/'` → `base: '/yourapp/'`
- `entry.tsx`: Line 11, 30, 47, 60 - all `__myapp` → `__yourapp`
- `index.html`: Line 16 `basename: '/myapp'` → `basename: '/yourapp'`
- `.github/workflows/build.yml`: Line 18 `APP_NAME: myapp` → `APP_NAME: yourapp`

### 3. Initialize and install

```bash
# Initialize git (if not already done)
git init

# Install dependencies
npm install

# Start local development
npm run dev
# Visit http://localhost:5173/yourapp/
```

### 4. Add GitHub secret

1. Create a GitHub Personal Access Token with `repo` permissions
2. Go to your repo → Settings → Secrets → Actions
3. Add secret: `HADOKU_WATCHPARTY_DEPLOY_TOKEN` = your token

### 5. Push to deploy

```bash
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YourUsername/hadoku-yourapp.git
git push -u origin main
```

GitHub Actions will automatically build and deploy to hadoku_site!

## 📚 File Details

### Required Files

#### `src/entry.tsx` ⭐ CRITICAL
**Must export `mount` and `unmount` functions:**
```typescript
export function mount(el: HTMLElement, props: MyAppProps = {}) { ... }
export function unmount(el: HTMLElement) { ... }
```

#### `vite.config.ts` ⭐ CRITICAL
**Must build as ES module library:**
```typescript
build: {
  lib: {
    entry: 'src/entry.tsx',
    formats: ['es'],
    fileName: () => 'index.js',
  },
  rollupOptions: {
    external: ['react', 'react-dom/client'],
  },
}
```

#### `.github/workflows/build.yml` ⭐ CRITICAL
**Must set APP_NAME:**
```yaml
env:
  APP_NAME: yourapp  # CHANGE THIS!
```

### Optional Files

#### `src/App.tsx`
Sample component - replace with your own app logic.

#### `index.html`
Local development page - customize as needed.

#### `styles.css`
Basic CSS reset - add your styles or use a framework.

## 🔧 Customization

### Using Different Frameworks

**Vue:**
```bash
npm install vue
# Change vite config to use @vitejs/plugin-vue
```

**Svelte:**
```bash
npm install svelte
# Change vite config to use @sveltejs/vite-plugin-svelte
```

### Using Different Package Managers

**pnpm:**
```yaml
# In .github/workflows/build.yml
env:
  BUILD_COMMAND: pnpm run build
# Uncomment pnpm setup step
```

**yarn:**
```yaml
# In .github/workflows/build.yml
env:
  BUILD_COMMAND: yarn build
# Uncomment yarn setup step
```

### Adding CSS Frameworks

**Tailwind:**
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Styled Components:**
```bash
npm install styled-components
```

## 🎯 Testing Locally

### Test mount/unmount manually

Create a test HTML file:

```html
<!DOCTYPE html>
<html>
<body>
  <div id="test-root"></div>
  <button onclick="testMount()">Mount</button>
  <button onclick="testUnmount()">Unmount</button>
  
  <script type="module">
    import { mount, unmount } from './src/entry.tsx';
    
    window.testMount = () => {
      const el = document.getElementById('test-root');
      mount(el, {
        basename: '/myapp',
        apiUrl: 'http://localhost:3000',
        environment: 'test'
      });
    };
    
    window.testUnmount = () => {
      const el = document.getElementById('test-root');
      unmount(el);
    };
  </script>
</body>
</html>
```

### Test with hadoku_site integration

1. Build your app: `npm run build`
2. Copy `dist/*` to `hadoku_site/public/mf/yourapp/`
3. Update hadoku_site's `registry.json`
4. Visit `http://localhost:4321/yourapp/` (or your hadoku_site dev port)

## ❓ FAQ

**Q: Do I need to install React?**
A: Yes, for local development. But it's marked as `external` so it won't be bundled. hadoku_site provides React via import maps.

**Q: Can I use a different port?**
A: Yes, change `server.port` in `vite.config.ts`.

**Q: How do I add environment variables?**
A: Use props instead! The parent passes config via the `props` parameter in `mount()`.

**Q: My styles aren't working?**
A: Make sure the CSS file is being built to `dist/style.css` and referenced in hadoku_site's registry.

**Q: Can I use TypeScript strict mode?**
A: Yes! It's already enabled in `tsconfig.json`.

## 📖 Further Reading

- [Complete Guide](../CREATE_MICRO_FRONTEND.md) - Full documentation
- [Architecture](../MICRO_FRONTEND_CONFIG.md) - How the system works
- [Workflow Template](../generic-micro-frontend-workflow.yml) - Deployment automation

## 🆘 Troubleshooting

**Build fails with "React is not defined":**
- Check that React is marked as `external` in `vite.config.ts`

**App doesn't mount:**
- Check browser console for errors
- Verify `mount` function is exported from `entry.tsx`
- Check that element ID matches (`#root` in your case)

**Styles don't apply:**
- Verify `import './styles.css'` in `entry.tsx`
- Check that `dist/style.css` was built
- Add to hadoku_site registry: `"css": "/mf/yourapp/style.css"`

**GitHub Actions fails:**
- Verify `HADOKU_WATCHPARTY_DEPLOY_TOKEN` secret is set
- Check that token has `repo` and `workflow` permissions
- Ensure APP_NAME matches your folder name

---

**Ready to build?** 🚀

Copy these files, customize, and you're ready to create your first micro-frontend!
