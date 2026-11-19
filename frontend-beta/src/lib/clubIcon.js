// Client-side club icon checks. They mirror the server rules so a bad file is
// refused before upload; the server still decodes and validates everything.
export const ICON_RULES = { maxBytes: 2 * 1024 * 1024, minSide: 128, types: ['image/jpeg', 'image/png', 'image/webp'] }
export const ICON_HELP = 'JPEG, PNG or WebP, at least 128×128, up to 2 MB. Square images work best; others are cropped from the centre.'

// Returns an error sentence, or '' when the file looks fine.
// `size` is { width, height } from the decoded image (null if it could not be read).
export function iconProblem(file, size) {
  if (!file) return 'Choose an image.'
  if (!ICON_RULES.types.includes(file.type)) return 'Club icons must be JPEG, PNG or WebP images.'
  if (file.size > ICON_RULES.maxBytes) return 'Club icons can be at most 2 MB.'
  if (!size) return 'That image could not be read. Try another file.'
  if (size.width < ICON_RULES.minSide || size.height < ICON_RULES.minSide) return 'Club icons need at least 128×128 pixels.'
  return ''
}

export function iconForm(file) {
  const form = new FormData()
  form.set('file', file)
  return form
}
