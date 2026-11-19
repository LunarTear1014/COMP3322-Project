import { useState } from 'react'
import { request } from '../api'
import { Button } from './ui'
import { useResource } from '../hooks/resources'

const toggle = (list, id, max) => (list.includes(id) ? list.filter(item => item !== id) : list.length < max ? [...list, id] : list)

// Campus tags (1 to 3 from the shared list) and the club's own tags (0 to 5,
// with "Add club tag" for committee members). Values are tag IDs.
export function TagPicker({ clubId, campus, club, onCampus, onClub, error }) {
  const campusTags = useResource('/tags')
  const clubTags = useResource(clubId ? `/clubs/${clubId}/tags` : null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function addTag() {
    setBusy(true)
    setMessage('')
    try {
      const { data } = await request(`/clubs/${clubId}/tags`, { method: 'POST', body: { name: name.trim() } })
      setName('')
      clubTags.refresh()
      onClub(toggle(club, data.id, 5))
    } catch (failure) {
      setMessage(failure.fields?.name || failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <fieldset className={`tag-picker${error ? ' is-invalid' : ''}`}>
        <legend>Campus tags <span className="cs-hint">Choose 1 to 3.</span></legend>
        <div className="cs-row">
          {campusTags.data?.map(tag => {
            const chosen = campus.includes(tag.id)
            return (
              <label key={tag.id} className="cs-chip-filter tag-option" aria-pressed={chosen}>
                <input type="checkbox" className="cs-sr" checked={chosen} disabled={!chosen && campus.length >= 3} onChange={() => onCampus(toggle(campus, tag.id, 3))} />
                {tag.name}
              </label>
            )
          })}
        </div>
        {error && <span className="cs-error" role="alert">{error}</span>}
      </fieldset>
      {clubId && (
        <fieldset className="tag-picker">
          <legend>Club tags <span className="cs-hint">Optional, up to 5.</span></legend>
          <div className="cs-row">
            {clubTags.data?.map(tag => {
              const chosen = club.includes(tag.id)
              return (
                <label key={tag.id} className="cs-chip-filter tag-option" aria-pressed={chosen}>
                  <input type="checkbox" className="cs-sr" checked={chosen} disabled={!chosen && club.length >= 5} onChange={() => onClub(toggle(club, tag.id, 5))} />
                  {tag.name}
                </label>
              )
            })}
          </div>
          <div className="cs-row">
            <label className="cs-sr" htmlFor="new-club-tag">New club tag</label>
            <input id="new-club-tag" className="cs-input" maxLength={24} placeholder="New club tag…" value={name} onChange={event => setName(event.target.value)} />
            <Button disabled={!name.trim()} busy={busy} onClick={addTag}>Add club tag</Button>
          </div>
          {message && <span role="alert" className="cs-error">{message}</span>}
        </fieldset>
      )}
    </>
  )
}
