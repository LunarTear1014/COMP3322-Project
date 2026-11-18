import { Link } from 'react-router'

const VARIANT_CLASS = {
  primary: 'cs-btn-primary',
  secondary: '',
  ghost: 'cs-btn-ghost',
  danger: 'cs-btn-danger',
  success: 'cs-btn-success',
  white: 'cs-btn-surface',
}

function classes({ variant = 'secondary', block = false, className = '' }) {
  return ['cs-btn', VARIANT_CLASS[variant], block && 'cs-btn-block', className].filter(Boolean).join(' ')
}

// Use for actions. While `busy` the button keeps its place, announces aria-busy
// and ignores clicks so a request is never sent twice. A disabled button's
// label should say why ("Registration closed").
export function Button({ variant, block, busy = false, className, children, onClick, type = 'button', ...rest }) {
  return (
    <button
      {...rest}
      type={type}
      className={classes({ variant, block, className })}
      aria-busy={busy || undefined}
      onClick={busy ? event => event.preventDefault() : onClick}
    >
      {busy && <span className="cs-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

// Use for navigation, so Cmd-click and middle-click work.
export function ButtonLink({ variant, block, className, children, ...rest }) {
  return <Link {...rest} className={classes({ variant, block, className })}>{children}</Link>
}
