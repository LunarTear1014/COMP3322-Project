import { Check, X } from 'lucide-react'

// Organizer surface: flat, no sticker shadows. The current step carries
// aria-current="step"; a failed step shows an x and its reason.
export function LifecycleStepper({ steps }) {
  return (
    <ol className="cs-steps" aria-label="Event progress">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`cs-step${step.state === 'done' ? ' is-done' : ''}${step.state === 'current' ? ' is-current' : ''}${step.state === 'failed' ? ' is-failed' : ''}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="cs-step-dot" aria-hidden="true">
            {step.state === 'done' ? <Check className="cs-icon" /> : step.state === 'failed' ? <X className="cs-icon" /> : index + 1}
          </span>
          {step.label}
          {step.note && <small>{step.note}</small>}
        </li>
      ))}
    </ol>
  )
}
