import type { ObjectType } from '../shared/types'

/**
 * Canonical color token for one object type.
 * Use these values across all UI surfaces (tabs, chips, nav items, badges)
 * to keep the visual identity consistent.
 */
export interface ObjectColorToken {
  /** Text / icon color — for labels and icons on dark surfaces */
  text: string
  /** Translucent fill — for selected rows, card backgrounds, and event chips */
  bg: string
  /** Translucent border — for card outlines and event chip borders */
  border: string
  /** Solid accent — for Tabs indicator, left-border strips, and active markers */
  accent: string
  /** Translucent glow — for box-shadow on selected cards (border/glow, not fill) */
  selectionGlow: string
}

type ColorableType = Exclude<ObjectType, 'tag'>

/** One canonical color mapping per object type. */
export const objectColors: Record<ColorableType, ObjectColorToken> = {
  'daily-note':   { text: '#cbe3ff', bg: 'rgba(74,144,255,0.24)',  border: 'rgba(74,144,255,0.62)',  accent: '#4a90ff', selectionGlow: 'rgba(74,144,255,0.52)'  },
  'topic-note':   { text: '#c9ffe1', bg: 'rgba(46,201,126,0.24)',  border: 'rgba(46,201,126,0.62)',  accent: '#2ec97e', selectionGlow: 'rgba(46,201,126,0.52)'  },
  'habit':        { text: '#ffe0b9', bg: 'rgba(255,155,64,0.24)',  border: 'rgba(255,155,64,0.62)',  accent: '#ff9b40', selectionGlow: 'rgba(255,155,64,0.52)'  },
  'project':      { text: '#e9d0ff', bg: 'rgba(176,96,255,0.24)',  border: 'rgba(176,96,255,0.62)',  accent: '#b060ff', selectionGlow: 'rgba(176,96,255,0.52)'  },
  'ref-material': { text: '#ffd0ef', bg: 'rgba(255,92,186,0.24)',  border: 'rgba(255,92,186,0.62)',  accent: '#ff5cba', selectionGlow: 'rgba(255,92,186,0.52)'  },
  'scripture':    { text: '#ffe5ae', bg: 'rgba(255,198,62,0.24)',  border: 'rgba(255,198,62,0.62)',  accent: '#ffc63e', selectionGlow: 'rgba(255,198,62,0.52)'  },
}

/** Look up the color token for a given object type string, falling back to daily-note colors. */
export function getObjectColor(type: string): ObjectColorToken {
  return (objectColors as Record<string, ObjectColorToken>)[type] ?? objectColors['daily-note']
}
