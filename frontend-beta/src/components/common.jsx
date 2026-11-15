

export function PageHeading({ title, description }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</div>
}
export function ErrorNotice({ error }) { return error && <div role="alert" className="error">{error.message} {error.retryAfter && `Try again after ${error.retryAfter} seconds.`}{Object.entries(error.fields || {}).map(([k,v]) => <p key={k}>{k}: {v}</p>)}</div> }
export function Resource({ value, children, empty = 'Nothing to show.', allowEmpty = false }) { return <><ErrorNotice error={value.error}/>{value.error && <button className="secondary-button" onClick={value.refresh}>Try again</button>}{value.loading && <p role="status">{value.data ? 'Refreshing…' : 'Loading…'}</p>}{value.data && (Array.isArray(value.data) && !value.data.length && !allowEmpty ? <p>{empty}</p> : children)}</> }
export function Pagination({ meta, page, setPage }) { return meta && meta.total > meta.page_size && <div className="row"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {meta.page} · {meta.total} total</span><button disabled={meta.page * meta.page_size >= meta.total} onClick={() => setPage(page + 1)}>Next</button></div> }
export function Feedback({ action }) { return <><ErrorNotice error={action.error}/>{action.message && <p role="status">{action.message}</p>}</> }
