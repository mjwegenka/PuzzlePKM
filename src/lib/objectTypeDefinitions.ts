import type { ObjectType } from '../shared/types'
import { formatDatePretty } from './dateUtils'

function sanitizeDisplayText(value: string): string {
  return String(value)
    .replace(/<!--\s*blk-[a-f0-9]{12}\s*-->/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPrimaryTag(tags: unknown): string {
  if (!Array.isArray(tags)) return ''
  return tags
    .map((tag) => String(tag ?? '').trim())
    .find(Boolean) ?? ''
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function topicNoteTitle(data: Record<string, unknown>): string {
  const title = sanitizeDisplayText(String(data.title ?? ''))
  if (title) return title

  const previewCandidate = sanitizeDisplayText(String(data.preview ?? ''))
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (previewCandidate) return previewCandidate.slice(0, 60)

  const date = String(data.date ?? '').trim()
  if (date) return formatDatePretty(date)

  return 'Topic Note'
}

function dailyNoteTitle(data: Record<string, unknown>): string {
  const date = String(data.date ?? '').trim()
  return date ? formatDatePretty(date) : 'Daily Note'
}

function habitTitle(data: Record<string, unknown>): string {
  const primaryTag = getPrimaryTag(data.tags)
  const date = String(data.date ?? '').trim()
  const friendlyDate = date ? formatDatePretty(date) : ''

  if (primaryTag && friendlyDate) return `${primaryTag} - ${friendlyDate}`
  if (primaryTag) return primaryTag
  if (friendlyDate) return friendlyDate

  const text = sanitizeDisplayText(String(data.text ?? ''))
  return text || '(no text)'
}

function projectTitle(data: Record<string, unknown>): string {
  const name = sanitizeDisplayText(String(data.name ?? ''))
  return name || 'Project'
}

function refMaterialTitle(data: Record<string, unknown>): string {
  const name = sanitizeDisplayText(String(data.name ?? ''))
  return name || 'Reference Material'
}

function scriptureTitle(data: Record<string, unknown>): string {
  const reference = sanitizeDisplayText(String(data.reference ?? data.title ?? ''))
  return reference || 'Scripture'
}

function tagTitle(data: Record<string, unknown>): string {
  const displayName = sanitizeDisplayText(String(data.displayName ?? data.name ?? data.title ?? ''))
  if (!displayName) return '#Tag'
  return displayName.startsWith('#') ? displayName : `#${displayName}`
}

export interface ObjectTypeDefinition {
  getDisplayTitle: (object: Record<string, unknown>) => string
}

export const OBJECT_TYPE_DEFINITIONS: Record<ObjectType, ObjectTypeDefinition> = {
  'topic-note': { getDisplayTitle: topicNoteTitle },
  'daily-note': { getDisplayTitle: dailyNoteTitle },
  habit: { getDisplayTitle: habitTitle },
  project: { getDisplayTitle: projectTitle },
  'ref-material': { getDisplayTitle: refMaterialTitle },
  scripture: { getDisplayTitle: scriptureTitle },
  tag: { getDisplayTitle: tagTitle },
}

export function isObjectType(value: string): value is ObjectType {
  return Object.prototype.hasOwnProperty.call(OBJECT_TYPE_DEFINITIONS, value)
}

export function getObjectDisplayTitle(type: ObjectType, object: unknown): string {
  return OBJECT_TYPE_DEFINITIONS[type].getDisplayTitle(asRecord(object))
}


