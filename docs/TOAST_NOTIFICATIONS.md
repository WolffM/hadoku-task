# Toast Notification System

## Overview

Added a toast notification system to provide user feedback for key events and actions.

## Features

### 1. Welcome Toast on Mount

- **Trigger**: When authenticated user (friend/admin) logs in
- **Message**:
  - If `userName` prop provided: `"Welcome back, {userName}"`
  - If friend userType: `"Welcome back!"`
  - If admin userType: `"Welcome back, Admin"`
- **Type**: Success (green checkmark)
- **Duration**: 3000ms (3 seconds)

### 2. Access Key Validation

- **Trigger**: When user enters a new access key in Settings
- **Messages**:
  - On validation start: `"Validating access key..."` (info)
  - On invalid key: `"Invalid access key"` or custom error (error)
  - On valid key: Toast briefly shows before page reload
- **Implementation**: Via Settings Modal

### 3. Refresh Successful

- **Trigger**: When user clicks the refresh/sync button
- **Messages**:
  - On success: `"Refresh successful"` (success)
  - On failure: `"Refresh failed"` (error)
- **Duration**: 3000ms (3 seconds)

## Parent Site Integration

### Required Props

Update the parent site to pass these props to the task app:

```typescript
interface TaskAppProps {
  userName?: string // Optional: Display name for welcome message
  onKeyValidation?: (isValid: boolean, userType?: string, userName?: string) => void
}
```

### Example Usage

```typescript
// In parent site's task app initialization
mount(document.getElementById('task-app'), {
  userType: 'friend',
  sessionId: sessionId,
  userName: 'John Doe', // Get from user session
  onKeyValidation: (isValid, userType, userName) => {
    if (!isValid) {
      // Show error toast (handled by task app)
      // Clear invalid key from storage
      localStorage.removeItem('accessKey')
      // Redirect to public
      window.location.href = '/task/public'
    } else {
      // Valid key - update storage and reload
      localStorage.setItem('accessKey', newKey)
      window.location.href = `/task/${userType}`
    }
  }
})
```

### Invalid Key Toast from Parent

For the scenario where a stored key is invalid on mount/refresh, the parent site should:

1. Validate the key before mounting the task app
2. If invalid, show an error toast using the parent's notification system
3. Clear the invalid key from storage
4. Redirect to `/task/public`

```typescript
// Example: Parent site validation on mount
async function initTaskApp() {
  const storedKey = localStorage.getItem('accessKey')

  if (storedKey) {
    const validation = await validateKey(storedKey)

    if (!validation.valid) {
      // Show toast notification
      showToast('Invalid access key - redirecting to public mode', 'error')

      // Clear invalid key
      localStorage.removeItem('accessKey')

      // Redirect after brief delay for toast visibility
      setTimeout(() => {
        window.location.href = '/task/public'
      }, 1500)
      return
    }

    // Valid key - mount with user info
    mountTaskApp({
      userType: validation.userType,
      sessionId: validation.sessionId,
      userName: validation.userName
    })
  } else {
    // No key - mount as public
    mountTaskApp({
      userType: 'public',
      sessionId: 'public'
    })
  }
}
```

## Technical Implementation

### Components

- **`Toast`**: Individual toast notification component
- **`useToast`**: Hook for managing toast state and display

### Files Modified

1. `src/components/Toast.tsx` - Toast component
2. `src/hooks/useToast.ts` - Toast state management hook
3. `src/styles/toast.css` - Toast styles
4. `src/app/App.tsx` - Integration of toast system
5. `src/app/entry.tsx` - Updated props interface
6. `src/components/BoardsSection.tsx` - Added refresh toast
7. `src/components/modals/SettingsModal.tsx` - Added key validation toast

### Toast Types

- **Success**: Green checkmark icon, green border
- **Error**: Red X icon, red border
- **Info**: Blue info icon, accent color border

### Positioning

- Desktop: Top-right corner (20px from edges)
- Mobile: Top-center (10px from edges, full width)

### Animation

- Fade in with slide from right (300ms cubic-bezier)
- Auto-dismiss after duration
- Fade out with slide to right (300ms)

## Future Enhancements

Consider adding toasts for:

- Task created successfully
- Board created successfully
- Tag operations
- Error states (failed to save, network errors, etc.)
