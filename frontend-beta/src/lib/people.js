// Plain words for the organizer's people views. Colour only reinforces the word.
export const CLUB_ROLE = {
  president: { label: 'President', className: 'cs-chip-members' },
  committee: { label: 'Committee', className: 'cs-chip-members' },
  member: { label: 'Member', className: 'cs-chip-joined' },
}
export const NON_MEMBER = { label: 'Non-member', className: 'cs-chip-neutral' }
export const roleChip = role => CLUB_ROLE[role] ?? NON_MEMBER

export const PARTICIPANT_STATUS = { joined: 'Joined', waitlisted: 'Waitlisted', left: 'Quit', cancelled: 'Cancelled by event', unsuccessful: 'Not successful' }
export const statusWord = status => PARTICIPANT_STATUS[status] ?? status
