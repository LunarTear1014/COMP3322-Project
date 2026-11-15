// What a list shows when it has nothing in it. Always offer a way forward.
// Never render this while loading or after a failed load.
export function EmptyState({ title, children, actions }) {
  return (
    <section className="cs-empty">
      <svg className="cs-empty-art" viewBox="0 0 120 84" aria-hidden="true">
        <rect className="b" x="14" y="16" width="70" height="58" rx="10" />
        <path className="c" d="M14 32h70M32 8v14M66 8v14" />
        <path className="c" d="M34 50l10 10M44 50L34 60M56 50l10 10M66 50L56 60" />
        <circle className="a" cx="96" cy="22" r="14" />
        <path className="c" d="M96 12v20M87.3 17l17.4 10M87.3 27l17.4-10" />
      </svg>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="cs-row" style={{ justifyContent: 'center' }}>{actions}</div>}
    </section>
  )
}
