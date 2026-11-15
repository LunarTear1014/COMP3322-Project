import { addDays, campusDate, campusInstant, weekStart } from '../apiShared.js'

// Event filters live in the page URL so a filtered view can be shared and
// survives a refresh:  ?q=walk&when=week&visibility=public&club_id=2&tag=music
// Presets (when=week|month) are turned into UTC instants only when asking the API.

export const MAX_RANGE_DAYS = 93
const VISIBILITY = ['public', 'members_only']
const WHEN = ['week', 'month']
const PHASE = ['upcoming', 'past']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[1-9]\d{0,9}$/

const realDate = value => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

// Reads filters from URLSearchParams, dropping anything malformed.
export function readFilters(params) {
  const pick = (key, allowed) => (allowed.includes(params.get(key)) ? params.get(key) : '')
  const page = /^[1-9]\d{0,5}$/.test(params.get('page') || '') ? Number(params.get('page')) : 1
  const from = realDate(params.get('from') || '') ? params.get('from') : ''
  const to = realDate(params.get('to') || '') ? params.get('to') : ''
  return {
    q: (params.get('q') || '').slice(0, 100),
    phase: pick('phase', PHASE) || 'upcoming',
    club_id: ID.test(params.get('club_id') || '') ? params.get('club_id') : '',
    venue_id: ID.test(params.get('venue_id') || '') ? params.get('venue_id') : '',
    visibility: pick('visibility', VISIBILITY),
    when: pick('when', WHEN),
    from: pick('when', WHEN) ? '' : from,
    to: pick('when', WHEN) ? '' : to,
    tag: [...new Set(params.getAll('tag').filter(tag => /^[a-z0-9-]{1,32}$/.test(tag)))].slice(0, 5),
    page,
  }
}

// Writes only non-default values, so default views have clean URLs.
export function writeFilters(filters) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.phase && filters.phase !== 'upcoming') params.set('phase', filters.phase)
  for (const key of ['club_id', 'venue_id', 'visibility', 'when']) if (filters[key]) params.set(key, filters[key])
  if (!filters.when && filters.from) params.set('from', filters.from)
  if (!filters.when && filters.to) params.set('to', filters.to)
  for (const tag of filters.tag || []) params.append('tag', tag)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

// Campus Monday 00:00 to the next Monday 00:00, as UTC instants.
export function weekRange(now = new Date()) {
  const monday = weekStart(campusDate(now))
  return { from: campusInstant(monday, '00:00'), to: campusInstant(addDays(monday, 7), '00:00') }
}

// The first of this campus month to the first of the next.
export function monthRange(now = new Date()) {
  const today = campusDate(now)
  const first = `${today.slice(0, 8)}01`
  const next = new Date(`${first}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { from: campusInstant(first, '00:00'), to: campusInstant(next.toISOString().slice(0, 10), '00:00') }
}

// A custom range is from the start of `from` through the end of `to`.
export function customRange(filters) {
  if (!filters.from || !filters.to) return null
  return { from: campusInstant(filters.from, '00:00'), to: campusInstant(addDays(filters.to, 1), '00:00') }
}

export function rangeProblem(filters) {
  if (filters.when || (!filters.from && !filters.to)) return ''
  if (!filters.from || !filters.to) return 'Choose both dates.'
  const range = customRange(filters)
  if (new Date(range.to) <= new Date(range.from)) return 'The end date must not be before the start date.'
  if (new Date(range.to) - new Date(range.from) > MAX_RANGE_DAYS * 86400000) return `Choose a range of at most ${MAX_RANGE_DAYS} days.`
  return ''
}

// The /events query for these filters (array values repeat their key).
export function toApiQuery(filters, now = new Date()) {
  const range = filters.when === 'week' ? weekRange(now) : filters.when === 'month' ? monthRange(now) : customRange(filters)
  return {
    q: filters.q,
    phase: filters.phase,
    club_id: filters.club_id,
    venue_id: filters.venue_id,
    visibility: filters.visibility,
    tag: filters.tag,
    from: range?.from,
    to: range?.to,
    page: filters.page > 1 ? filters.page : '',
  }
}

// Filters that live in the sheet (everything but search and the quick chips).
export function sheetFilterCount(filters) {
  return [filters.club_id, filters.venue_id, filters.from || filters.to, ...filters.tag].filter(Boolean).length
}

export function activeFilterCount(filters) {
  return sheetFilterCount(filters) + [filters.q, filters.when, filters.visibility, filters.phase === 'past'].filter(Boolean).length
}

export const clearedFilters = { q: '', phase: 'upcoming', club_id: '', venue_id: '', visibility: '', when: '', from: '', to: '', tag: [], page: 1 }
