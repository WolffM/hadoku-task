/**
 * Generate a unique session ID for this browser tab/session
 * Used to identify which tab made changes when coordinating cross-tab sync via BroadcastChannel
 */
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
