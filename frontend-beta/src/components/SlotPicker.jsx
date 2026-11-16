import { ChevronLeft, ChevronRight } from 'lucide-react'
import { slotLabel, weekLabel } from '../lib/slots'

// Choose a venue slot from what is actually free. Past days and slots, and slots
// another booking holds, are disabled and say why. Pending requests never hold a
// slot, so they never appear here. The server stays authoritative (409).
export function SlotPicker({ venueName, weekStartDate, days, selected, onWeek, onDay, onSelect, loading, canGoBack = true, notice }) {
  const day = days.find(item => item.date === selected.date) ?? days[0]
  return (
    <div className="cs-picker slot-picker">
      <div className="cs-picker-head">
        <button className="cs-iconbtn" type="button" aria-label="Previous week" disabled={!canGoBack} onClick={() => onWeek(-1)}>
          <ChevronLeft className="cs-icon" aria-hidden="true" />
        </button>
        <h3>{venueName} · {weekLabel(weekStartDate)}</h3>
        <button className="cs-iconbtn" type="button" aria-label="Next week" onClick={() => onWeek(1)}>
          <ChevronRight className="cs-icon" aria-hidden="true" />
        </button>
      </div>
      {notice}
      <div className="cs-days" role="group" aria-label="Choose a day">
        {days.map(item => (
          <button
            key={item.date}
            className="cs-day"
            type="button"
            disabled={item.past}
            aria-pressed={item.date === day.date}
            aria-label={`${item.label}${item.past ? ', past' : ''}`}
            onClick={() => onDay(item.date)}
          >
            {item.weekday}<b>{item.number}</b>
          </button>
        ))}
      </div>
      <div className="slot-list" role="group" aria-label={`Slots on ${day.label}`} aria-busy={loading || undefined}>
        {day.slots.map(({ slot, status, holder }) => {
          const chosen = selected.date === day.date && selected.slot_id === slot.id
          const disabled = status !== 'available'
          return (
            <button
              key={slot.id}
              className="cs-slot"
              type="button"
              disabled={disabled || loading}
              aria-pressed={disabled ? undefined : chosen}
              onClick={() => onSelect(day.date, slot.id)}
            >
              {slotLabel(slot)}
              <em>{status === 'past' ? 'Past' : status === 'booked' ? `Booked · ${holder}` : chosen ? 'Selected' : 'Available'}</em>
            </button>
          )
        })}
      </div>
      <span className="cs-hint">Hong Kong time. Pending requests don’t hold a slot.</span>
    </div>
  )
}
