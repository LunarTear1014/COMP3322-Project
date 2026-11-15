import { Link } from 'react-router'
import { PageHeading } from '../components/common'

export function WorkflowUnavailable({ title }) {
  return <main><PageHeading title={title} description="This workflow requires the ClubSpace v1 provider."/><Link to="/events">Back to events</Link></main>
}
