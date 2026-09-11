/**
 * Cross-route toast handoff (Room → Home) so restart / gone copy
 * remains visible after navigate replaces RoomPage.
 */
const FLASH_TOAST_KEY = 'party-box:flash-toast'

export function setFlashToast(text: string): void {
  try {
    sessionStorage.setItem(FLASH_TOAST_KEY, text)
  } catch {
    /* ignore */
  }
}

export function takeFlashToast(): string | null {
  try {
    const text = sessionStorage.getItem(FLASH_TOAST_KEY)
    if (text) sessionStorage.removeItem(FLASH_TOAST_KEY)
    return text
  } catch {
    return null
  }
}
