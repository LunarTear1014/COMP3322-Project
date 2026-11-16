import { useRef } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeading, Resource } from '../components/common'
import { EventCard } from '../components/EventCard'
import { ButtonLink, EmptyState, StatusChip } from '../components/ui'
import { useAllOptions } from '../hooks/resources'
import { TABS, chipFor, sortRegistrations } from '../lib/myEvents'

const EMPTY = {
  upcoming: { title: 'You haven’t joined anything yet', text: 'Find something happening on campus and tap Join event.', action: <ButtonLink variant="primary" to="/events">Explore events</ButtonLink> },
  waitlist: { title: 'No waitlists', text: 'When an event is full you can join its waitlist and we’ll tell you if a seat opens.', action: <ButtonLink to="/events">Explore events</ButtonLink> },
  past: { title: 'No past events yet', text: 'Events you’ve been to, left or that were cancelled will show up here.', action: null },
}

// My events: Upcoming, Waitlist and Past, with the tab kept in the URL.
export function Registrations() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = TABS.some(item => item.id === requested) ? requested : 'upcoming'
  const registrations = useAllOptions('/me/registrations')
  const refs = useRef({})
  const groups = sortRegistrations(registrations.data || [])

  function select(id) { setParams(id === 'upcoming' ? {} : { tab: id }) }
  function onKeyDown(event) {
    const index = TABS.findIndex(item => item.id === tab)
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (move === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + move + TABS.length) % TABS.length
    select(TABS[next].id)
    refs.current[TABS[next].id]?.focus()
  }

  const items = groups[tab]
  return (
    <main className="page">
      <PageHeading title="My events" description="What you’re going to, waiting for and have been to. Times are in Hong Kong time." />
      <div className="tabs" role="tablist" aria-label="My events" onKeyDown={onKeyDown}>
        {TABS.map(item => (
          <button
            key={item.id}
            ref={element => { refs.current[item.id] = element }}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            className="tab-link"
            aria-selected={tab === item.id}
            aria-controls="my-events-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => select(item.id)}
          >
            {item.label}<span className="tab-count" aria-label={`${groups[item.id].length} events`}>{groups[item.id].length}</span>
          </button>
        ))}
      </div>
      <div id="my-events-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <Resource value={registrations} allowEmpty>
          {items.length === 0 ? (
            <EmptyState title={EMPTY[tab].title} actions={EMPTY[tab].action}>{EMPTY[tab].text}</EmptyState>
          ) : (
            <div className="card-grid event-grid">
              {items.map(registration => (
                <EventCard
                  source="my_events"
                  key={registration.event.id}
                  event={{ ...registration.event, my_registration: { status: ['pending', 'waitlisted'].includes(registration.status) ? 'waitlisted' : registration.status, queue_position: registration.queue_position } }}
                  chip={tab === 'past' && chipFor(registration) === 'left' ? <StatusChip state="left" /> : undefined}
                />
              ))}
            </div>
          )}
        </Resource>
      </div>
    </main>
  )
}
