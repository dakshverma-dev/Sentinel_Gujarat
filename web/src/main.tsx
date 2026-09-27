import { createRoot } from 'react-dom/client'
import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-600.css'
import '@fontsource/fraunces/latin-900.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-500.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import 'leaflet/dist/leaflet.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
