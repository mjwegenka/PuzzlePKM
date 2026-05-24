import { alpha, createTheme } from '@mui/material/styles'
import type { CSSProperties } from 'react'

declare module '@mui/material/styles' {
  interface TypographyVariants {
    'metadata-caption': CSSProperties
    'card-title': CSSProperties
    'card-date': CSSProperties
    'snippet-body': CSSProperties
  }

  interface TypographyVariantsOptions {
    'metadata-caption'?: CSSProperties
    'card-title'?: CSSProperties
    'card-date'?: CSSProperties
    'snippet-body'?: CSSProperties
  }

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

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    'metadata-caption': true
    'card-title': true
    'card-date': true
    'snippet-body': true
  }
}

export const neutralDarkTokens = {
  surface: {
    app: '#1b1d20',
    elevated: '#1e2024',
    sunken: '#20242a',
  },
  border: {
    subtle: alpha('#ffffff', 0.08),
    strong: alpha('#ffffff', 0.13),
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

export const cardTypographyTokens = {
  'metadata-caption': {
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0.3px',
    color: neutralDarkTokens.text.muted,
  },
  'card-title': {
    fontSize: '19px',
    fontWeight: 700,
    lineHeight: 1.3,
  },
  'card-date': {
    fontSize: '19px',
    fontWeight: 700,
    lineHeight: 1.3,
  },
  'snippet-body': {
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.5,
  },
} as const

export const cardSpacingTokens = {
  cardPadding: 2, // 16px
  cardVerticalGutter: 1.5, // 12px
  sidebarRowMinHeight: 32,
  sidebarRowPaddingX: 1, // 8px
  sidebarRowPaddingY: 0.5, // 4px
  toolbarRowMinHeight: 42,
} as const

export const appTheme = createTheme({
  typography: cardTypographyTokens,
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
      selected: alpha(neutralDarkTokens.accent.selected, 0.18),
      hover: alpha('#ffffff', 0.04),
      focus: alpha(neutralDarkTokens.accent.selected, 0.24),
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
        ':root': {
          '--focus-ring-color': theme.palette.accent.selected,
          '--focus-ring-shadow': alpha(theme.palette.accent.selected, 0.34),
        },
        body: {
          backgroundColor: theme.palette.surface.app,
          color: theme.palette.text.primary,
        },
        a: {
          color: theme.palette.accent.link,
        },
        'button, [href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])': {
          transition: 'outline-color 120ms ease, box-shadow 120ms ease',
        },
        'button:focus-visible, [href]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [role="button"]:focus-visible, [tabindex]:not([tabindex="-1"]):focus-visible':
          {
            outline: '2px solid var(--focus-ring-color)',
            outlineOffset: '2px',
            boxShadow: '0 0 0 4px var(--focus-ring-shadow)',
            borderRadius: '8px',
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
