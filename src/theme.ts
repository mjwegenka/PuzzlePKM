import { alpha, createTheme } from '@mui/material/styles'

export const appTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#111315',
      paper: '#171a1f',
    },
    primary: {
      main: '#60a5fa',
    },
    secondary: {
      main: '#94a3b8',
    },
    divider: alpha('#ffffff', 0.08),
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
          fontWeight: 500,
        },
      },
    },
  },
})
