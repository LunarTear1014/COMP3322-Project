// Shared validation constants — single source of truth for field rules.
// Keep in sync with backend schemas (backend-beta/src/api_v1/auth.js).

export const STUDENT_ID = {
  min: 1,
  max: 50,
  pattern: /^[A-Za-z0-9-]+$/,
  patternMessage: 'Use letters, digits and hyphens only.',
}

export function validateStudentId(value) {
  const v = String(value ?? '').trim()
  if (v.length < STUDENT_ID.min || v.length > STUDENT_ID.max) return false
  return STUDENT_ID.pattern.test(v)
}