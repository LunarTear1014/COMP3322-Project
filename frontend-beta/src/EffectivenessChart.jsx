import { BarChart } from '@mui/x-charts/BarChart'

// Fill rate and turnout per event, in percent. Turnout is left out (not zero)
// for events without check-in; the table below carries every exact number.
export default function EffectivenessChart({ events }) {
  const dataset = events.map(event => ({
    label: event.title.length > 18 ? `${event.title.slice(0, 17)}…` : event.title,
    fill: Math.round((event.fill_rate ?? 0) * 100),
    turnout: event.turnout == null ? null : Math.round(event.turnout * 100),
  }))
  return (
    <BarChart
      height={280}
      dataset={dataset}
      colors={['var(--lagoon)', 'var(--mint-ink)']}
      xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
      yAxis={[{ min: 0, max: 100, label: 'Percent' }]}
      series={[{ dataKey: 'fill', label: 'Filled at start (%)' }, { dataKey: 'turnout', label: 'Turnout (%)' }]}
      skipAnimation
    />
  )
}
