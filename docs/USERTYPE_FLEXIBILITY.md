# UserType Flexibility

## Overview

The `@wolffm/task` package supports **arbitrary user type identifiers**, not just the predefined `public`, `friend`, and `admin` types. You can use any string as a userType, such as:

- `"John"`
- `"alice"`
- `"team-frontend"`
- `"project-x"`
- Any other string identifier

## Behavior

### Public Mode (userType = "public")

- **localStorage only**: No server synchronization
- Data stored in `hadoku-public-tasks` and `hadoku-public-stats`
- Perfect for anonymous/guest users or demo mode

### All Other Modes (userType = anything else)

- **Optimistic updates**: localStorage for instant UI response
- **Background sync**: Asynchronous server synchronization to Cloudflare Workers KV
- Data stored in `hadoku-${userType}-tasks` and `hadoku-${userType}-stats`
- Examples:
  - `userType="friend"` → `hadoku-friend-tasks`
  - `userType="John"` → `hadoku-John-tasks`
  - `userType="team-alpha"` → `hadoku-team-alpha-tasks`

## Usage

### From Parent Application

```typescript
import { mount } from '@wolffm/task/frontend'

// Standard types
mount(element, { userType: 'public' })  // localStorage only
mount(element, { userType: 'friend' })  // localStorage + server sync
mount(element, { userType: 'admin' })   // localStorage + server sync

// Custom types - work exactly like friend/admin
mount(element, { userType: 'John' })    // localStorage + server sync
mount(element, { userType: 'alice' })   // localStorage + server sync
```

### From URL Parameters

```
https://example.com/task?userType=public  # localStorage only
https://example.com/task?userType=friend  # localStorage + server
https://example.com/task?userType=John    # localStorage + server
https://example.com/task?userType=alice   # localStorage + server
```

## Parent Responsibilities

The parent application (hadoku-site) is responsible for:

1. **User Authentication**: Determine which userType identifier to use
2. **KV Storage**: Implement TaskHandlers that store/retrieve data from Cloudflare Workers KV
3. **Route Mapping**: Map userType identifiers to KV keys/namespaces
4. **Authorization**: Validate that users can only access their own data

The child package (hadoku-task) handles:

1. **UI Updates**: Instant localStorage updates for all user types
2. **API Calls**: Background synchronization for non-public users
3. **Storage Keys**: Automatic generation of `hadoku-${userType}-tasks` keys

## Implementation Details

### Automatic Storage Key Generation

```typescript
// src/lib/localStorageApi.ts
const getTasksKey = (userType: string) => `hadoku-${userType}-tasks`
const getStatsKey = (userType: string) => `hadoku-${userType}-stats`

// Supports ANY userType string
createLocalStorageApi('John')       // → hadoku-John-tasks
createLocalStorageApi('team-alpha') // → hadoku-team-alpha-tasks
```

### Type Definitions

```typescript
// src/lib/types.ts
export type UserType = string  // Any string, not restricted to union

// src/entry.tsx
export interface TaskAppProps {
  userType?: string  // Any string supported
}

// src/lib/api.ts
export function createApi(userType: string = 'public') {
  // "public" is localStorage-only
  // Everything else gets server sync
}
```

## Adding New User Types

**No code changes needed!** The package automatically:

1. Creates localStorage keys for new userType values
2. Routes server sync for non-public types
3. Isolates data between different userTypes

Just pass the new userType identifier:

```typescript
// In parent app - automatically works
mount(element, { userType: 'new-user-123' })
```

The parent's TaskHandlers receive the userType in the AuthContext and can store data accordingly in Cloudflare Workers KV.

## Migration Path

Existing deployments with hardcoded `public`/`friend`/`admin` continue to work exactly as before. New user types can be added without any changes to the child package - just implement the storage/authorization logic in the parent.
