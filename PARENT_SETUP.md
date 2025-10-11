# Parent Repo Workflow

The parent repo (`hadoku_site`) should have this workflow to handle package updates:

**`.github/workflows/update-packages.yml`**

```yaml
name: Update Child Packages

on:
  repository_dispatch:
    types: [package_updated]
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Create .npmrc for GitHub Packages
        run: |
          echo "@wolffm:registry=https://npm.pkg.github.com" > .npmrc
          echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> .npmrc
      
      - name: Update package
        run: |
          PACKAGE="${{ github.event.client_payload.package }}"
          echo "Updating $PACKAGE to latest version..."
          npm install $PACKAGE@latest
      
      - name: Commit and push if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          
          if git diff --quiet package.json package-lock.json; then
            echo "No package updates needed"
          else
            git add package.json package-lock.json
            git commit -m "chore: update ${{ github.event.client_payload.package }}"
            git push
            echo "✅ Updated package and pushed changes"
          fi
```

## How it works:

1. **hadoku-task** pushes to main
2. GitHub Actions publishes `@wolffm/task` to GitHub Packages
3. Workflow triggers `repository_dispatch` to `hadoku_site`
4. **hadoku_site** runs `npm install @wolffm/task@latest`
5. If package.json changed, commits and pushes
6. Parent's existing deploy workflow picks up the change and redeploys

**Note:** Make sure `HADOKU_SITE_TOKEN` secret is added to hadoku-task repo with `repo` scope.
