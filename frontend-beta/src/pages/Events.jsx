import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { query } from '../api'
import { PageHeading, ErrorNotice, Resource, Pagination } from '../components/common'
import { EventCard } from '../components/EventCard'
import { FilterChips } from '../components/FilterChips'
import { BottomSheet, Button, EmptyState, TextField } from '../components/ui'
import { useAllOptions, useResource } from '../hooks/resources'
import {
  activeFilterCount, clearedFilters, rangeProblem, readFilters, sheetFilterCount, toApiQuery, writeFilters,
} from '../lib/eventFilters'

export { EventCard }

// Event discovery. Every filter is a URL parameter (?when=week&visibility=public),
// so a filtered view can be shared and survives a refresh.
export function Events() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState(filters)
  const clubs = useAllOptions('/clubs')
  const venues = useAllOptions('/venues')
  const campusTags = useResource('/tags')

  const problem = rangeProblem(filters)
  const apiQuery = query(toApiQuery(filters))
  const results = useResource(problem ? null : `/events${apiQuery}`)
  const draftProblem = rangeProblem(draft)

  const apply = next => setParams(writeFilters({ ...next, page: next.page ?? 1 }), { replace: false })
  const set = patch => apply({ ...filters, ...patch, page: 1 })

  const chips = [
    { key: 'week', label: 'This week', pressed: filters.when === 'week' },
    { key: 'month', label: 'This month', pressed: filters.when === 'month' },
    { key: 'public', label: 'Open to everyone', pressed: filters.visibility === 'public' },
    { key: 'members_only', label: 'Members only', pressed: filters.visibility === 'members_only' },
    { key: 'past', label: 'Past events', pressed: filters.phase === 'past' },
  ]
  for (const tag of campusTags.data ?? []) chips.push({ key: `tag:${tag.slug}`, label: tag.name, pressed: filters.tag.includes(tag.slug) })
  function toggle(key) {
    if (key.startsWith('tag:')) {
      const slug = key.slice(4)
      set({ tag: filters.tag.includes(slug) ? filters.tag.filter(item => item !== slug) : [...filters.tag, slug].slice(0, 5) })
      return
    }
    if (key === 'week' || key === 'month') set({ when: filters.when === key ? '' : key, from: '', to: '' })
    else if (key === 'past') set({ phase: filters.phase === 'past' ? 'upcoming' : 'past' })
    else set({ visibility: filters.visibility === key ? '' : key })
  }

  function openSheet() { setDraft(filters); setSheetOpen(true) }
  function applySheet() { apply({ ...draft, page: 1 }); setSheetOpen(false) }
  const draftChange = patch => setDraft(current => ({ ...current, ...patch }))

  const total = results.meta?.total
  const noFilters = activeFilterCount(filters) === 0
  const filtered = !noFilters

  return (
    <main className="page">
      <PageHeading title="Find your next event." description="Explore what’s happening across campus. Times are in Hong Kong time." />
      <form className="search-row" role="search" onSubmit={event => event.preventDefault()}>
        <Search className="cs-icon search-icon" aria-hidden="true" />
        <input
          type="search"
          className="cs-input search-input"
          aria-label="Search events"
          placeholder="Search by title, club or venue…"
          maxLength={100}
          value={filters.q}
          onChange={event => set({ q: event.target.value })}
        />
      </form>
      <FilterChips chips={chips} onToggle={toggle} onOpenSheet={openSheet} sheetCount={sheetFilterCount(filters)} sheetOpen={sheetOpen} />
      <ErrorNotice error={clubs.error} /><ErrorNotice error={venues.error} />

      {problem ? (
        <p role="alert" className="cs-error">{problem} <Button variant="ghost" onClick={() => set({ from: '', to: '' })}>Clear dates</Button></p>
      ) : (
        <Resource
          value={results}
          allowEmpty
        >
          {results.data?.length === 0 ? (
            filtered ? (
              <EmptyState title="Nothing matches these filters" actions={<Button variant="primary" onClick={() => apply(clearedFilters)}>Clear filters</Button>}>
                Try a wider date range, another club or fewer filters.
              </EmptyState>
            ) : (
              <EmptyState title="No events yet" actions={<Button onClick={() => set({ phase: filters.phase === 'past' ? 'upcoming' : 'past' })}>{filters.phase === 'past' ? 'See upcoming events' : 'See past events'}</Button>}>
                Nothing is scheduled right now. Check back soon.
              </EmptyState>
            )
          ) : (
            <>
              <p className="cs-meta result-count" role="status">{total != null && `${total} ${total === 1 ? 'event' : 'events'}`}</p>
              <div className="card-grid event-grid">
                {results.data?.map((event, index) => <EventCard key={event.id} event={event} eager={index < 2} source={filters.club_id ? 'club' : 'explore'} />)}
              </div>
              <Pagination meta={results.meta} page={filters.page} setPage={page => apply({ ...filters, page })} />
            </>
          )}
        </Resource>
      )}

      <BottomSheet
        open={sheetOpen}
        title="Filters"
        onClose={() => setSheetOpen(false)}
        footer={(
          <>
            <Button onClick={() => setDraft({ ...clearedFilters, q: draft.q })}>Clear all</Button>
            <Button variant="primary" disabled={Boolean(draftProblem)} onClick={applySheet}>Show events</Button>
          </>
        )}
      >
        <TextField as="select" label="Club" name="club_id" value={draft.club_id} onChange={event => draftChange({ club_id: event.target.value })}>
          <option value="">All clubs</option>
          {clubs.data?.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
        </TextField>
        <TextField as="select" label="Venue" name="venue_id" value={draft.venue_id} onChange={event => draftChange({ venue_id: event.target.value })}>
          <option value="">All venues</option>
          {venues.data?.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </TextField>
        <TextField as="select" label="Who can join" name="visibility" value={draft.visibility} onChange={event => draftChange({ visibility: event.target.value })}>
          <option value="">Everyone and members only</option>
          <option value="public">Open to everyone</option>
          <option value="members_only">Members only</option>
        </TextField>
        <TextField label="From date" name="from" type="date" value={draft.from} onChange={event => draftChange({ from: event.target.value, when: '' })} />
        <TextField label="Through date" name="to" type="date" value={draft.to} error={draftProblem} onChange={event => draftChange({ to: event.target.value, when: '' })} />
      </BottomSheet>
    </main>
  )
}
