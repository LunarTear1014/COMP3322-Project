import { CircleAlert } from 'lucide-react'
import { Button, EmptyState } from './ui'

export function PageHeading({ title, description }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</div>
}

// What happened and what to do next. Field errors come from the API's `fields`.
export function ErrorNotice({ error }) {
  if (!error) return null
  return (
    <div role="alert" className="notice notice-error">
      <CircleAlert className="cs-icon" aria-hidden="true" />
      <div>
        <p>{error.message}{error.retryAfter && ` Try again after ${error.retryAfter} seconds.`}</p>
        {Object.entries(error.fields || {}).map(([key, value]) => <p key={key}>{key}: {value}</p>)}
      </div>
    </div>
  )
}

// Loading uses skeleton cards, a failed load shows the error with Try again,
// and an empty list shows an EmptyState: three different things.
function Skeleton() {
  return (
    <div className="card-grid" aria-hidden="true">
      {[0, 1, 2].map(index => <div key={index} className="skeleton-card" />)}
    </div>
  )
}

export function Resource({ value, children, empty = 'Nothing to show.', allowEmpty = false }) {
  const isEmpty = value.data && Array.isArray(value.data) && !value.data.length && !allowEmpty
  return (
    <>
      <ErrorNotice error={value.error} />
      {value.error && <Button onClick={value.refresh}>Try again</Button>}
      {value.loading && (
        <>
          <p role="status" className="cs-sr">{value.data ? 'Refreshing…' : 'Loading…'}</p>
          {!value.data && !value.error && <Skeleton />}
        </>
      )}
      {value.data && (isEmpty ? (typeof empty === 'string' ? <EmptyState title={empty} /> : empty) : children)}
    </>
  )
}

export function Pagination({ meta, page, setPage }) {
  if (!meta || meta.total <= meta.page_size) return null
  return (
    <nav className="cs-row pagination" aria-label="Pages">
      <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="cs-meta cs-nums">Page {meta.page} · {meta.total} total</span>
      <Button disabled={meta.page * meta.page_size >= meta.total} onClick={() => setPage(page + 1)}>Next</Button>
    </nav>
  )
}

export function Feedback({ action }) {
  return <><ErrorNotice error={action.error} />{action.message && <p role="status">{action.message}</p>}</>
}
