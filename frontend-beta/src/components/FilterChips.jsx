import { SlidersHorizontal } from 'lucide-react'

// Quick filters above the event grid: 44px toggle chips that scroll sideways on
// phones. `chips` are { key, label, pressed }. The first chip opens the sheet;
// its count is announced as "N active".
export const FilterChips = ({ chips, onToggle, onOpenSheet, sheetCount, sheetOpen }) => (
  <div className="cs-filter-strip" role="toolbar" aria-label="Event filters">
    <button className="cs-chip-filter cs-chip-filter-more" type="button" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={onOpenSheet}>
      <SlidersHorizontal className="cs-icon" aria-hidden="true" />Filters
      {sheetCount > 0 && <span className="cs-count" aria-label={`${sheetCount} active`}>{sheetCount}</span>}
    </button>
    {chips.map(chip => (
      <button key={chip.key} className="cs-chip-filter" type="button" aria-pressed={chip.pressed} onClick={() => onToggle(chip.key)}>
        {chip.label}
      </button>
    ))}
  </div>
)
