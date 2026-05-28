import type { ObjectType } from '../shared/types'
import { withAlpha } from './colorUtils'

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

function buildToken(accent: string): ObjectColorToken {
  return {
    text: accent,
    bg: withAlpha(accent, 0.18),
    border: withAlpha(accent, 0.42),
    accent,
    selectionGlow: withAlpha(accent, 0.5),
  }
}

/** One canonical color mapping per object type. */
export const objectColors: Record<ColorableType, ObjectColorToken> = {
  'daily-note': buildToken('#36cfc9'),
  'topic-note': buildToken('#52c41a'),
  'habit': buildToken('#1677ff'),
  'project': buildToken('#722ed1'),
  'ref-material': buildToken('#eb2f96'),
  'scripture': buildToken('#f5222d'),
}

/** Look up the color token for a given object type string, falling back to daily-note colors. */
export function getObjectColor(type: string): ObjectColorToken {
  return (objectColors as Record<string, ObjectColorToken>)[type] ?? objectColors['daily-note']
}
