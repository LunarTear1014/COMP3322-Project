import { ClubIcon } from './ClubIcon'

// The top of a club card: the club's photo as a cropped banner, or the
// club-colour pattern when it has none, with the club icon (or badge) on its
// lower edge. The photo's alt text describes the picture; the icon is decorative.
// `photo` is the API's { card_url, alt } object (or null).
export function ClubBanner({ name, icon, photo, eager = false }) {
  return (
    <div className={`cs-clubhead club-banner${photo ? ' has-photo' : ''}`}>
      {photo ? (
        <img className="club-photo" src={photo.card_url} width="600" height="400" alt={photo.alt || ''} loading={eager ? 'eager' : 'lazy'} decoding="async" />
      ) : (
        <div className="cs-cover-art" aria-hidden="true" />
      )}
      <ClubIcon name={name} icon={icon} />
    </div>
  )
}
