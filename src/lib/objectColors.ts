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

type ColorableType = Exclude<ObjectType, 'tag'> | 'tag' | 'scripture-book' | 'scripture-chapter' | 'document'

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
  'tag': buildToken('#faad14'),
  'scripture-book': buildToken('#f5222d'),
  'scripture-chapter': buildToken('#f5222d'),
  // DEC-79: files inside project and ref-material folders.
  'document': buildToken('#fa541c'),
}

/** Look up the color token for a given object type string, falling back to daily-note colors. */
export function getObjectColor(type: string): ObjectColorToken {
  return (objectColors as Record<string, ObjectColorToken>)[type] ?? objectColors['daily-note']
}

/**
 * Canonical sections of scripture, used to color chapter nodes so a graph of
 * chapters reads as recognizable regions of the Bible rather than one flat mass.
 * Ordered by `bookOrder` boundaries from SCRIPTURE_BOOK_ORDER in cli/app.mjs.
 */
export type ScriptureSection = 'pentateuch' | 'historical' | 'wisdom' | 'prophets' | 'gospels' | 'epistles'

const SCRIPTURE_SECTION_COLORS: Record<ScriptureSection, string> = {
  pentateuch: '#d4380d',
  historical: '#d46b08',
  wisdom: '#d4b106',
  prophets: '#7cb305',
  gospels: '#f5222d',
  epistles: '#c41d7f',
}

const SCRIPTURE_SECTION_LABELS: Record<ScriptureSection, string> = {
  pentateuch: 'Pentateuch',
  historical: 'Historical',
  wisdom: 'Wisdom',
  prophets: 'Prophets',
  gospels: 'Gospels & Acts',
  epistles: 'Epistles & Revelation',
}

/** Map a canonical book order index onto its section of scripture. */
export function getScriptureSection(bookOrder: number): ScriptureSection {
  if (bookOrder <= 4) return 'pentateuch'   // 0 Genesis – 4 Deuteronomy
  if (bookOrder <= 16) return 'historical'  // 5 Joshua – 16 Esther
  if (bookOrder <= 21) return 'wisdom'      // 17 Job – 21 Song of Solomon
  if (bookOrder <= 44) return 'prophets'    // 22 Isaiah – 44 2 Maccabees
  if (bookOrder <= 49) return 'gospels'     // 45 Matthew – 49 Acts
  return 'epistles'                         // 50 Romans – 71 Revelation
}

export function getScriptureSectionColor(bookOrder: number): string {
  return SCRIPTURE_SECTION_COLORS[getScriptureSection(bookOrder)]
}

/** The color for a section itself — for legends, where there is no book order. */
export function getSectionColor(section: ScriptureSection): string {
  return SCRIPTURE_SECTION_COLORS[section]
}

export function getScriptureSectionLabel(section: ScriptureSection): string {
  return SCRIPTURE_SECTION_LABELS[section]
}

export const SCRIPTURE_SECTIONS: ScriptureSection[] = [
  'pentateuch', 'historical', 'wisdom', 'prophets', 'gospels', 'epistles',
]
