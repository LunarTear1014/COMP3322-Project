import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/components.css'
import './styles/app.css'
import './styles/layout.css'
import './styles/event.css'
import './index.css'
import { ThemeProvider } from '@mui/material/styles'
import App from './App.jsx'
import { muiTheme } from './muiTheme.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={muiTheme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
