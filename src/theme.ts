import { alpha, createTheme } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    surface: {
      app: string
      elevated: string
      sunken: string
    }
    border: {
      subtle: string
      strong: string
    }
    accent: {
      link: string
      selected: string
      metadata: string
    }
  }

  interface PaletteOptions {
    surface?: {
      app?: string
      elevated?: string
      sunken?: string
    }
    border?: {
      subtle?: string
      strong?: string
    }
    accent?: {
      link?: string
      selected?: string
      metadata?: string
    }
  }
}

export const neutralDarkTokens = {
  surface: {
    app: '#121315',
    elevated: '#1a1c1f',
    sunken: '#17191c',
  },
  border: {
    subtle: alpha('#ffffff', 0.09),
    strong: alpha('#ffffff', 0.16),
  },
  text: {
    primary: '#eceff3',
    secondary: '#b8bec8',
    muted: '#9198a3',
  },
  accent: {
    link: '#66a8ff',
    selected: '#4f8fed',
    metadata: '#d96b77',
  },
} as const

export const appTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: neutralDarkTokens.surface.app,
      paper: neutralDarkTokens.surface.elevated,
    },
    text: {
      primary: neutralDarkTokens.text.primary,
      secondary: neutralDarkTokens.text.secondary,
      disabled: neutralDarkTokens.text.muted,
    },
    divider: neutralDarkTokens.border.subtle,
    primary: {
      main: neutralDarkTokens.accent.selected,
    },
    secondary: {
      main: neutralDarkTokens.text.secondary,
    },
    error: {
      main: neutralDarkTokens.accent.metadata,
    },
    action: {
      selected: alpha(neutralDarkTokens.accent.selected, 0.28),
      hover: alpha('#ffffff', 0.04),
      focus: alpha(neutralDarkTokens.accent.selected, 0.34),
    },
    surface: {
      app: neutralDarkTokens.surface.app,
      elevated: neutralDarkTokens.surface.elevated,
      sunken: neutralDarkTokens.surface.sunken,
    },
    border: {
      subtle: neutralDarkTokens.border.subtle,
      strong: neutralDarkTokens.border.strong,
    },
    accent: {
      link: neutralDarkTokens.accent.link,
      selected: neutralDarkTokens.accent.selected,
      metadata: neutralDarkTokens.accent.metadata,
    },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        body: {
          backgroundColor: theme.palette.surface.app,
          color: theme.palette.text.primary,
        },
        a: {
          color: theme.palette.accent.link,
        },
        '::selection': {
          backgroundColor: alpha(theme.palette.accent.selected, 0.32),
        },
      }),
    },
    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: 'none',
          backgroundColor: theme.palette.surface.elevated,
          border: `1px solid ${theme.palette.border.subtle}`,
        }),
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
