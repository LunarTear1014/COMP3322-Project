// A club's icon, or its colour badge with the first letter when it has none.
// The icon is decorative next to the club name, so it is hidden from assistive
// technology. `icon` is the API's { url } object (or null).
export function ClubIcon({ name, icon, className = 'cs-clubbadge' }) {
  if (icon?.url) return <img className={`${className} has-icon`} src={icon.url} width="52" height="52" alt="" />
  return <span className={className} aria-hidden="true">{[...(name || '?')][0]}</span>
}
