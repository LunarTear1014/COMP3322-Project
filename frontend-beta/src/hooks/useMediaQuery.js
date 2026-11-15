import { useSyncExternalStore } from 'react'

// Subscribes to a CSS media query. Without matchMedia (tests, very old
// browsers) the query counts as not matching, i.e. the desktop layout.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    notify => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

// Phones get the bottom tab bar and the sticky event action.
export const PHONE_QUERY = '(max-width: 767.98px)'
export const usePhone = () => useMediaQuery(PHONE_QUERY)
