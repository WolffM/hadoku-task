/**
 * Authentication utilities
 * Functions for handling user authentication and key validation
 */

/**
 * Validate a key and redirect to the authenticated page
 * @param key - The authentication key to validate
 * @param validateKeyFn - Function that validates the key (from API client)
 * @returns Promise with success status and optional error message
 */
export async function validateAndChangeKey(
  key: string,
  validateKeyFn: (key: string) => Promise<boolean>
): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = key.trim()
  
  if (!trimmedKey) {
    return { success: false, error: 'Key cannot be empty' }
  }
  
  try {
    const isValid = await validateKeyFn(trimmedKey)
    
    if (isValid) {
      // Valid key - reload page with new key parameter
      const url = new URL(window.location.href)
      url.searchParams.set('key', trimmedKey)
      const newUrl = url.toString()
      
      // Notify parent window (mobile app) of URL change
      if (window.parent !== window) {
        console.log('📨 Notifying mobile app of URL change')
        window.parent.postMessage({
          type: 'urlChange',
          url: newUrl
        }, '*')
      }
      
      window.location.href = newUrl
      return { success: true }
    } else {
      return { success: false, error: 'Invalid key' }
    }
  } catch (err) {
    console.error('[Auth] Key validation failed:', err)
    return { success: false, error: 'Failed to validate key' }
  }
}
