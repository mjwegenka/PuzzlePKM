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
    app: '#1c1c1e',
    elevated: '#2a2a2c',
    sunken: '#161618',
  },
  border: {
    subtle: alpha('#ffffff', 0.09),
    strong: alpha('#ffffff', 0.18),
  },
  text: {
    primary: '#f5f3ef',
    secondary: '#c7c0b2',
    muted: '#8a8478',
  },
  accent: {
    link: '#e3b341',
    selected: '#e3b341',
    metadata: '#e3b341',
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
    fontSize: '18px',
    fontWeight: 650,
    lineHeight: 1.3,
  },
  'card-date': {
    fontSize: '18px',
    fontWeight: 650,
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
      selected: alpha(neutralDarkTokens.accent.selected, 0.22),
      hover: alpha('#ffffff', 0.045),
      focus: alpha(neutralDarkTokens.accent.selected, 0.28),
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
          '--color-surface-app': theme.palette.surface.app,
          '--color-surface-elevated': theme.palette.surface.elevated,
          '--color-surface-sunken': theme.palette.surface.sunken,
          '--color-border-subtle': theme.palette.border.subtle,
          '--color-border-strong': theme.palette.border.strong,
          '--color-text-primary': theme.palette.text.primary,
          '--color-text-secondary': theme.palette.text.secondary,
          '--color-text-disabled': theme.palette.text.disabled,
          '--color-accent-link': theme.palette.accent.link,
          '--color-accent-selected': theme.palette.accent.selected,
          '--color-accent-metadata': theme.palette.accent.metadata,
          '--color-action-hover': theme.palette.action.hover,
          '--color-action-focus': theme.palette.action.focus,
          '--color-selected-fill': theme.palette.accent.selected,
          '--color-selected-fill-soft': alpha(theme.palette.accent.selected, 0.2),
          '--color-success-main': '#87b487',
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
          border: 'none',
          borderRadius: 0,
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
