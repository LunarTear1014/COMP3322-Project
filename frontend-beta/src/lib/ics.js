// Client-side Add to calendar: an RFC 5545 file built from the event's UTC
// instants, so it lands at the right hour in any calendar app.

const stamp = instant => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const escapeText = text => String(text ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1')

// Lines over 75 octets are folded with CRLF + space.
function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out = []
  let current = ''
  let size = 0
  for (const char of line) {
    const width = new TextEncoder().encode(char).length
    if (size + width > (out.length ? 74 : 75)) { out.push(current); current = ''; size = 0 }
    current += char
    size += width
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(event, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClubSpace//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@clubspace`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.start_at)}`,
    `DTEND:${stamp(event.end_at)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText([event.venue?.name, event.venue?.location].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${escapeText(`${event.club?.name ?? ''}${event.description ? `\n${event.description}` : ''}`.trim())}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

export function icsFileName(event) {
  const slug = event.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${slug || 'event'}.ics`
}

// Triggers a download in the browser.
export function downloadIcs(event) {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = icsFileName(event)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
