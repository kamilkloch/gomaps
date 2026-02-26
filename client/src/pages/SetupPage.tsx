import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { useParams } from 'react-router-dom'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string

export function SetupPage() {
  const { projectId } = useParams()

  return (
    <div style={{ padding: '1rem' }}>
      <h2>Scrape Setup {projectId ? `· ${projectId}` : ''}</h2>
      <div style={{ width: '100%', height: '600px' }}>
        <APIProvider apiKey={API_KEY}>
          <Map
            defaultCenter={{ lat: 40.0, lng: 9.0 }}
            defaultZoom={6}
            gestureHandling="greedy"
            style={{ width: '100%', height: '100%' }}
          />
        </APIProvider>
      </div>
    </div>
  )
}
