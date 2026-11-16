import { ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { COVER_HELP, coverProblem, readImageSize } from '../lib/cover'
import { Button, TextField } from './ui'

// Add, replace or remove an event cover. Checks type, size and dimensions in
// the browser first, explains failures next to the control, and defaults the
// alt text to the event title. `current` is the saved cover ({card_url, alt}).
// `onChange({ file, alt } | null)` reports the staged file; `onSave` (optional)
// uploads it right away (used when editing an existing event).
export function CoverUploader({ title, current, serverError, busy = false, onChange, onSave, onRemove }) {
  const inputId = useId()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [alt, setAlt] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function choose(event) {
    const picked = event.target.files?.[0]
    if (!picked) return
    setChecking(true)
    const problem = coverProblem(picked, await readImageSize(picked).catch(() => null))
    setChecking(false)
    if (problem) {
      setError(problem)
      setFile(null)
      setPreview('')
      onChange?.(null)
      input.current.value = ''
      return
    }
    setError('')
    const nextAlt = alt || title || ''
    setAlt(nextAlt)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
    onChange?.({ file: picked, alt: nextAlt })
  }

  function changeAlt(value) {
    setAlt(value)
    if (file) onChange?.({ file, alt: value })
  }

  function clear() {
    setFile(null)
    setPreview('')
    setError('')
    input.current.value = ''
    onChange?.(null)
  }

  const shown = preview || current?.card_url
  const message = error || serverError
  return (
    <fieldset className="cover-uploader">
      <legend>Cover image <span className="cs-optional">(optional)</span></legend>
      <p className="cs-hint" id={`${inputId}-help`}>{COVER_HELP}</p>
      {shown && <img className="cover-preview" src={shown} width="600" height="400" alt={preview ? alt || 'Selected cover preview' : current?.alt || ''} />}
      <input ref={input} id={inputId} className="cs-sr" type="file" accept="image/jpeg,image/webp" aria-describedby={`${inputId}-help`} onChange={choose} />
      <div className="cs-row">
        <label htmlFor={inputId} className="cs-btn cover-pick" role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current.click() } }}>
          <ImagePlus className="cs-icon" aria-hidden="true" />{current || file ? 'Replace image' : 'Choose image'}
        </label>
        {file && <Button onClick={clear}>Clear choice</Button>}
        {current && !file && onRemove && <Button variant="danger" busy={busy} onClick={onRemove}><Trash2 className="cs-icon" aria-hidden="true" />Remove cover</Button>}
      </div>
      {checking && <p role="status" className="cs-hint">Checking image…</p>}
      {file && <TextField label="Describe the image" hint="Read aloud to people who can’t see it." maxLength={200} value={alt} onChange={event => changeAlt(event.target.value)} />}
      {file && onSave && <Button variant="primary" busy={busy} disabled={!alt.trim()} onClick={() => onSave({ file, alt })}>{busy ? 'Uploading…' : 'Upload cover'}</Button>}
      {busy && <progress className="cover-progress" aria-label="Uploading cover" />}
      {message && <p role="alert" className="cs-error">{message}</p>}
    </fieldset>
  )
}
