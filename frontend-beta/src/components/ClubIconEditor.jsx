import { ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ICON_HELP, iconProblem } from '../lib/clubIcon'
import { readImageSize } from '../lib/cover'
import { ClubIcon } from './ClubIcon'
import { Button } from './ui'

// Create, replace or remove a club's icon. Checks type, size and dimensions in
// the browser first and explains failures next to the control. `current` is the
// saved icon ({ url }); `onSave(file)` uploads the staged file, `onRemove()`
// deletes the saved one.
export function ClubIconEditor({ clubName, current, serverError, busy = false, onSave, onRemove }) {
  const inputId = useId()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function reset() {
    setFile(null)
    setPreview('')
    if (input.current) input.current.value = ''
  }

  async function choose(event) {
    const picked = event.target.files?.[0]
    if (!picked) return
    setChecking(true)
    const problem = iconProblem(picked, await readImageSize(picked).catch(() => null))
    setChecking(false)
    reset()
    if (problem) { setError(problem); return }
    setError('')
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
  }

  async function save() {
    const saved = await onSave(file)
    if (saved !== false) { setError(''); reset() }
  }

  const shown = preview ? { url: preview } : current
  const message = error || serverError
  return (
    <fieldset className="club-icon-editor">
      <legend>Club icon <span className="cs-optional">(optional)</span></legend>
      <p className="cs-hint" id={`${inputId}-help`}>{ICON_HELP}</p>
      <div className="cs-row">
        <ClubIcon name={clubName} icon={shown} className="club-icon-preview" />
        <input ref={input} id={inputId} className="cs-sr" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={`${inputId}-help`} onChange={choose} />
        <label htmlFor={inputId} className="cs-btn" role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current.click() } }}>
          <ImagePlus className="cs-icon" aria-hidden="true" />{current || file ? 'Replace icon' : 'Choose icon'}
        </label>
        {file && <Button onClick={() => { reset(); setError('') }}>Clear choice</Button>}
        {current && !file && <Button variant="danger" busy={busy} onClick={onRemove}><Trash2 className="cs-icon" aria-hidden="true" />Remove icon</Button>}
      </div>
      {checking && <p role="status" className="cs-hint">Checking image…</p>}
      {file && <Button variant="primary" busy={busy} onClick={save}>{busy ? 'Uploading…' : 'Upload icon'}</Button>}
      {message && <p role="alert" className="cs-error">{message}</p>}
    </fieldset>
  )
}
