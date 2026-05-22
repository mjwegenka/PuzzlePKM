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
  'daily-note':   { text: '#7dbad6', bg: 'rgba(26,138,181,0.18)',  border: 'rgba(26,138,181,0.45)',  accent: '#1a8ab5', selectionGlow: 'rgba(26,138,181,0.40)'  },
  'topic-note':   { text: '#7dcfaa', bg: 'rgba(72,178,120,0.18)',  border: 'rgba(72,178,120,0.45)',  accent: '#48b278', selectionGlow: 'rgba(72,178,120,0.40)'  },
  'habit':        { text: '#e8a84a', bg: 'rgba(200,131,42,0.18)',  border: 'rgba(200,131,42,0.45)',  accent: '#c8832a', selectionGlow: 'rgba(200,131,42,0.40)'  },
  'project':      { text: '#c49be8', bg: 'rgba(156,109,212,0.18)', border: 'rgba(156,109,212,0.45)', accent: '#9c6dd4', selectionGlow: 'rgba(156,109,212,0.40)' },
  'ref-material': { text: '#9ed8ef', bg: 'rgba(109,176,212,0.18)', border: 'rgba(109,176,212,0.45)', accent: '#6db0d4', selectionGlow: 'rgba(109,176,212,0.40)' },
  'scripture':    { text: '#f1c768', bg: 'rgba(214,154,44,0.18)',  border: 'rgba(214,154,44,0.45)',  accent: '#d69a2c', selectionGlow: 'rgba(214,154,44,0.40)'  },
}

/** Look up the color token for a given object type string, falling back to daily-note colors. */
export function getObjectColor(type: string): ObjectColorToken {
  return (objectColors as Record<string, ObjectColorToken>)[type] ?? objectColors['daily-note']
}
