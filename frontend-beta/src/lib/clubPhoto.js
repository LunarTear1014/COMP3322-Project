// Client-side club photo checks. They mirror the server rules so a bad file is
// refused before upload; the server still decodes and validates everything.
export const PHOTO_RULES = { maxBytes: 5 * 1024 * 1024, minWidth: 600, minHeight: 400, types: ['image/jpeg', 'image/png', 'image/webp'] }
export const PHOTO_HELP = 'JPEG, PNG or WebP, at least 600×400 (3:2 works best), up to 5 MB. Cards crop it from the centre, so keep the subject in the middle.'

// Returns an error sentence, or '' when the file looks fine.
// `size` is { width, height } from the decoded image (null if it could not be read).
export function photoProblem(file, size) {
  if (!file) return 'Choose an image.'
  if (!PHOTO_RULES.types.includes(file.type)) return 'Club photos must be JPEG, PNG or WebP images.'
  if (file.size > PHOTO_RULES.maxBytes) return 'Club photos can be at most 5 MB.'
  if (!size) return 'That image could not be read. Try another file.'
  if (size.width < PHOTO_RULES.minWidth || size.height < PHOTO_RULES.minHeight) return 'Club photos need at least 600×400 pixels.'
  return ''
}

export function photoForm({ file, alt }) {
  const form = new FormData()
  form.set('file', file)
  form.set('alt', alt.trim())
  return form
}
