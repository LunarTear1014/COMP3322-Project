export const CLUB_COLOURS = ['coral', 'mint', 'sun', 'blue', 'berry', 'lime', 'sky', 'tangerine']

// A club keeps one colour for its dot, fallback cover and header (club_id % 8).
export function clubColour(clubId) {
  const count = CLUB_COLOURS.length
  const index = (((Number(clubId) || 0) % count) + count) % count
  return { name: CLUB_COLOURS[index], cssVar: `var(--club-${CLUB_COLOURS[index]})` }
}
