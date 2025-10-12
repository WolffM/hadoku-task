# Design Document: Task Boards

## 1. Core Concepts

This document outlines a multi-board architecture for the task application. The goal is to allow users to segment their tasks into different "boards" while providing special administrative capabilities.

### 1.1. Identity Model
The concept of a flexible `userType` string is **reverted**. We will re-introduce a strict identity model composed of two properties provided by the parent application:

- **`userType`**: A string literal: `'public' | 'friend' | 'admin'`.
- **`userId`**: A string identifier for the user (e.g., `"john"`, `"hadoku"`).

This combination defines the user's identity and permissions.

### 1.2. Data Model: Boards
- A **Board** is a distinct collection of tasks.
- Each user can have multiple boards.
- Every user starts with a default board named **`main`**, which is auto-created on first use if it doesn't exist.

### 1.3. Storage Key Schema
The localStorage key for tasks and stats will follow a new, structured format:

**`<userType>-<userId>-<boardId>`**

- **Examples**:
  - `friend-john-main`
  - `friend-john-work`
  - `admin-hadoku-personal`
- **Public Mode**: Uses a static, non-persistent key: `public-public-main`. Data in this key is session-only and not synced.

## 2. Data Flow & State Management

### 2.1. Initial Load
- On application start, the client will make a single API call to fetch **all boards and all tasks** associated with the current `userId`.
- The API will return a tree-like structure:
  ```json
  {
    "boards": [
      { "id": "main", "name": "main", "tasks": [...], "stats": {...} },
      { "id": "work", "name": "work", "tasks": [...], "stats": {...} }
    ]
  }
  ```
- This entire data structure is loaded into the client's memory.

### 2.2. Board Switching
- Switching between boards (e.g., from "main" to "work") **does not trigger new API calls**.
- It is a client-side state change that simply renders the tasks from the selected board's data already in memory.
- This ensures instantaneous switching.

### 2.3. Per-Board UI State
- UI state such as **filters and sort order will be stored on a per-board basis** in memory.
- **Example**:
  1. User is on board "main" and filters by tag `#urgent`.
  2. User switches to board "work".
  3. User switches back to board "main".
  4. The `#urgent` filter is still active on the "main" board.

## 3. User Interface (UI) & User Experience (UX)

### 3.1. Board Management UI
The board management UI will be integrated directly above the task input field.

- **Default View**: A button displaying the current board's name (e.g., **`[ main ]`**) and a `+` button next to it.
  ```
  +------------------------------------------------+
  |  [ main v] [+]      Admin Management... (btn)  |  <-- Board UI
  +------------------------------------------------+
  |  [ Type a task and press Enter…             ]  |  <-- Task Input
  +------------------------------------------------+
  ```
- **Switching Boards**: Clicking the `[ main v]` button opens a simple dropdown menu listing the user's available boards. Selecting a board instantly switches the view.
- **Creating a Board**:
  1. User clicks the `[+]` button.
  2. The button is replaced by an input field: `[ Enter board name… ]`.
  3. User types a name (e.g., "work") and presses Enter.
  4. The UI optimistically creates the "work" board, adds it to the board list, and switches to it. An API call is made in the background.
- **Deleting a Board**:
  1. In the board selection dropdown, a trash icon (`🗑️`) appears on hover next to each board name **except "main"**. Users cannot delete their own "main" board.
  2. Clicking the icon prompts the user with a confirmation dialog: "Are you sure you want to delete this board and all its tasks? This cannot be undone."
  3. On confirmation, the board is optimistically removed from the UI, and a `deleteBoard` API call is made.

## 4. Roles & Permissions

### 4.1. Public (`userType: 'public'`)
- **No changes**. Remains a single, temporary, non-persistent board.
- No board management UI is visible.

### 4.2. Friend (`userType: 'friend'`)
- Can create, view, edit, and delete their **own** boards (`friend-<userId>-<boardId>`).
- Cannot see or interact with any other user's boards (friend or admin).

### 4.3. Admin (`userType: 'admin'`)
- **Personal Boards**: Can create, view, edit, and delete their own personal boards (`admin-<userId>-<boardId>`). These are private and cannot be seen by other admins or friends.
- **Friend Board Management**:
  - A new **"Admin Management"** button is visible only to admins.
  - Clicking this button opens a modal dialog.
  - **On-Demand Fetch**: Only when this dialog is opened does the client make an API call to fetch a list of all "friend" boards.
  - The dialog displays a list of all friend boards and allows an admin to **delete** them. This includes the ability to delete a user's "main" board.
  - **Deletion Flow (Non-Optimistic)**: When an admin deletes a board, the UI will show a loading state, wait for a success or failure response from the server, and then refresh the board list.
  - All admin actions on friend boards will be logged via telemetry to a service like Cloudflare Analytics for auditing.

## 5. Parent & Child Application Responsibilities

### 5.1. Child Package (`@wolffm/task`)
- Implement all UI/UX for board management.
- Manage the in-memory state for all of a user's boards.
- Handle optimistic updates for all board and task operations.
- Call the API functions provided by the parent for persistence.
- Revert `userType` back to a `'public' | 'friend' | 'admin'` enum and accept the new `userId` prop.

### 5.2. Parent Application (`hadoku-site`)
- Provide the `userType` and `userId` props to the child component.
- Implement and provide the following API functions to the child:
  - `getBoards(authContext)`: Fetches all boards and tasks for a user. If no boards exist, it should create a "main" board before returning.
  - `createBoard(authContext, boardName)`: Creates a new board.
  - `deleteBoard(authContext, boardId)`: Deletes a board.
  - `getFriendBoards(authContext)`: An admin-only endpoint to list all friend boards for moderation.
- Handle all server-side logic, including persistence to Cloudflare KV and authorization.
- Enforce the rule that a `userId` cannot exist under multiple `userType`s.

## 6. Edge Cases & Sync Behavior

### 6.1. Optimistic Update Assumption
For the initial implementation, we will assume a "happy path" where optimistic updates succeed. If an operation fails on the server after the UI has updated, a page refresh will be the manual workaround to get the correct state.

### 6.2. New User Initial State
For a brand-new user, the UI will be fully optimistic. The application will load instantly with an in-memory "main" board, and any initial actions (like creating a task) will be queued. In the background, API calls to create the board and the task will be sent to the parent to catch up.

### 6.3. Cross-Tab Synchronization
The existing `BroadcastChannel` is sufficient for synchronizing state. When a user creates or deletes a board in one tab, the API call will eventually complete. Other open tabs will receive the `tasks-updated` event and re-fetch their data from the server, which will include the updated list of boards. This sync is not instant but occurs after server confirmation.
