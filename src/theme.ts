import { withAlpha } from './lib/colorUtils'

export const neutralDarkTokens = {
  surface: {
    app: '#1c1c1e',
    elevated: '#2a2a2c',
    sunken: '#161618',
  },
  border: {
    subtle: withAlpha('#ffffff', 0.09),
    strong: withAlpha('#ffffff', 0.18),
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

export const appTheme = {
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
      selected: withAlpha(neutralDarkTokens.accent.selected, 0.22),
      hover: withAlpha('#ffffff', 0.045),
      focus: withAlpha(neutralDarkTokens.accent.selected, 0.28),
    },
    surface: neutralDarkTokens.surface,
    border: neutralDarkTokens.border,
    accent: neutralDarkTokens.accent,
  },
  shape: {
    borderRadius: 10,
  },
} as const
