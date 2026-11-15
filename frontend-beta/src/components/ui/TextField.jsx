import { CircleAlert } from 'lucide-react'
import { useId } from 'react'

// A labelled input, select or textarea. Pass `as="select"` (children are the
// options) or `as="textarea"`. Errors say what to do and are linked to the
// control; hints are linked too. Placeholders never replace the label.
export function TextField({ label, hint, error, optional = false, as = 'input', className = '', children, ...control }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const Control = as
  return (
    <div className={`cs-field${error ? ' is-invalid' : ''} ${className}`.trim()}>
      <label htmlFor={id}>{label}{optional && <> <span className="cs-optional">(optional)</span></>}</label>
      <Control
        {...control}
        id={id}
        className="cs-input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      >
        {as === 'select' ? children : undefined}
      </Control>
      {hint && <span className="cs-hint" id={hintId}>{hint}</span>}
      {error && (
        <span className="cs-error" id={errorId}>
          <CircleAlert className="cs-icon" aria-hidden="true" />{error}
        </span>
      )}
    </div>
  )
}
