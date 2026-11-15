import { Link } from 'react-router'
import { dateTile, seatSummary, timeLine } from '../lib/format'
import { clubColour } from '../lib/club'
import { Lock } from 'lucide-react'
import { StatusChip, Sticker, isAlmostFull } from './ui'

// An uploaded cover is an <img> with explicit dimensions (so nothing shifts as
// it loads); its alt is empty on cards because the title sits right below. With
// no cover, the club-colour art is drawn and hidden from assistive technology.
export function EventCover({ event, eager = false, children }) {
  const cover = event.cover
  return (
    <div className="cs-cover">
      {cover ? (
        <img src={cover.card_url} width="600" height="400" alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
      ) : (
        <div className="cs-cover-art" aria-hidden="true" />
      )}
      {children}
    </div>
  )
}

// One card, one link: the title link stretches over the card. Chips and
// stickers sit above it. Student surfaces use the sticker shadow; pass
// `flat` for organizer lists.
export function EventCard({ event, flat = false, eager = false, chip }) {
  const seats = seatSummary(event)
  const tile = dateTile(event.start_at)
  const colour = clubColour(event.club?.id)
  const full = event.joined_count >= event.capacity
  const hot = isAlmostFull(event.joined_count, event.capacity)
  const mine = event.my_registration?.status
  const sticker = event.state === 'cancelled' ? null
    : event.visibility === 'members_only' ? <Sticker tone="ink"><Lock className="cs-icon" aria-hidden="true" />Members only</Sticker>
    : hot ? <Sticker tone="coral">Almost full</Sticker>
    : null
  return (
    <article className={`cs-card event-card${flat ? ' is-flat' : ''}`} style={{ '--club': colour.cssVar }}>
      <EventCover event={event} eager={eager}>
        {sticker}
        <time className="cs-datetile" dateTime={tile.iso}><small>{tile.month}</small><b>{tile.day}</b></time>
      </EventCover>
      <div className="cs-card-body">
        <span className="cs-club"><i aria-hidden="true" /><span>{event.club?.name}</span></span>
        <h3 className="cs-card-title"><Link to={`/events/${event.id}`}>{event.title}</Link></h3>
        <span className="cs-meta">{timeLine(event.start_at, event.end_at)} · {event.venue?.name}</span>
        <div className="cs-meter">
          <div className="cs-meter-track" role="presentation">
            <div className={`cs-meter-fill${full ? ' is-full' : hot ? ' is-hot' : ''}`} style={{ width: `${Math.round(seats.ratio * 100)}%` }} />
          </div>
          <div className="cs-meter-caption">
            <span>{seats.joined}</span>
            <span className={hot ? 'is-hot' : undefined}>{hot ? 'Almost full' : seats.caption}</span>
          </div>
        </div>
        {(chip || (mine && mine !== 'none') || event.state === 'cancelled') && (
          <div className="cs-card-chips">
            {event.state === 'cancelled' && <StatusChip state="cancelled" />}
            {chip}
            {mine === 'joined' && <StatusChip state="joined" />}
            {['pending', 'waitlisted'].includes(mine) && <StatusChip state="waitlisted" position={event.my_registration.queue_position} />}
          </div>
        )}
      </div>
    </article>
  )
}
