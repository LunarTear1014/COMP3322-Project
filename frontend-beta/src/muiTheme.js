import { createTheme } from '@mui/material/styles'

// MUI components (report tables and charts) follow the same light/dark choice
// as the rest of the site, which comes from the system setting (theme.css).
// Without this, MUI keeps its light palette and draws dark text on the dark
// panels. The colours mirror the tokens in styles/tokens.css.
export const muiTheme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0068b0' },
        text: { primary: '#13202b', secondary: '#4d6070' },
        background: { default: '#f4f7fb', paper: '#ffffff' },
        divider: '#d3dde7',
      },
    },
    dark: {
      palette: {
        primary: { main: '#7cc4ff' },
        text: { primary: '#edf3f8', secondary: '#a5b6c6' },
        background: { default: '#0e161e', paper: '#1d2b38' },
        divider: '#2b3b4a',
      },
    },
  },
  typography: { fontFamily: 'var(--font-sans)' },
})
