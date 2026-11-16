// Client-side cover checks. They mirror the server rules so a bad file is
// refused before upload; the server still decodes and validates everything.
export const COVER_RULES = { maxBytes: 5 * 1024 * 1024, minWidth: 1200, minHeight: 800, types: ['image/jpeg', 'image/webp'] }
export const COVER_HELP = 'JPEG or WebP, at least 1200×800 (3:2 works best), up to 5 MB. Keep the bottom-left corner clear for the date.'

// Returns an error sentence, or '' when the file looks fine.
// `size` is { width, height } from the decoded image (null if it could not be read).
export function coverProblem(file, size) {
  if (!file) return 'Choose an image.'
  if (!COVER_RULES.types.includes(file.type)) return 'Covers must be JPEG or WebP images.'
  if (file.size > COVER_RULES.maxBytes) return 'Covers can be at most 5 MB.'
  if (!size) return 'That image could not be read. Try another file.'
  if (size.width < COVER_RULES.minWidth || size.height < COVER_RULES.minHeight) return 'Covers need at least 1200×800 pixels.'
  return ''
}

export function readImageSize(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    image.src = url
  })
}

export function coverForm({ file, alt, expectedVersion }) {
  const form = new FormData()
  form.set('file', file)
  form.set('alt', alt.trim())
  form.set('expected_version', String(expectedVersion))
  return form
}
