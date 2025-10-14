# PowerShell script to update imports after refactoring

$replacements = @{
    # App and entry
    "from './App'" = "from './app/App'"
    "from './entry'" = "from './app/entry'"
    
    # Domain types (most common)
    "from './types'" = "from '../domain/types'"
    "from '../server/types'" = "from '../domain/types'"
    "from './server/types'" = "from './domain/types'"
    "from '@hadoku/task/api/types'" = "from '../../domain/types'"
    "'@hadoku/task/api/types'" = "'../../domain/types'"
    
    # Domain handlers
    "from './server/handlers'" = "from './domain/handlers/handlers'"
    "from '../server/handlers'" = "from '../domain/handlers/handlers'"
    "from './handlers'" = "from './handlers/handlers'"
    "from './handlers-utils'" = "from './handlers-utils'"
    
    # Domain utils
    "from './server/utils'" = "from './domain/utils/shared'"
    "from '../server/utils'" = "from '../domain/utils/shared'"
    "from '../lib/tagUtils'" = "from '../domain/utils/tags'"
    "from './lib/tagUtils'" = "from './domain/utils/tags'"
    "from '../lib/ulid'" = "from '../domain/utils/ulid'"
    
    # API files
    "from '../lib/api'" = "from '../api/client'"
    "from './lib/api'" = "from './api/client'"
    "from '../lib/localStorageApi'" = "from '../api/localStorageApi'"
    "from '../lib/session'" = "from '../api/session'"
    "from './session'" = "from '../session'"
    "from '../lib/storage/LocalStorageStorage'" = "from '../api/storage/LocalStorageStorage'"
    
    # Utils
    "from '../lib/dragDropUtils'" = "from '../utils/dragDrop'"
    "from './lib/dragDropUtils'" = "from './utils/dragDrop'"
    "from '../lib/formatters'" = "from '../utils/formatters'"
    "from '../lib/layoutUtils'" = "from '../utils/layout'"
    
    # Hooks (now with index files)
    "from './hooks/useTasks'" = "from './hooks/useTasks'"
    "from '../hooks/useTasks'" = "from '../hooks/useTasks'"
    "from './useTasksHelpers'" = "from './helpers'"
    "from './hooks/useDragAndDrop'" = "from './hooks/useDragAndDrop'"
    "from '../hooks/useDragAndDrop'" = "from '../hooks/useDragAndDrop'"
}

# Get all TypeScript files
$files = Get-ChildItem -Path "src" -Include *.ts,*.tsx -Recurse -File

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    foreach ($old in $replacements.Keys) {
        $new = $replacements[$old]
        $content = $content -replace [regex]::Escape($old), $new
    }
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Updated: $($file.FullName)"
    }
}

Write-Host "`nImport update complete!"
