export type TagFilterMode = 'include' | 'exclude'
export type TagFilterState = Record<string, TagFilterMode>

export function normalizeTagFilterValue(value: string): string {
  return String(value ?? '').trim().replace(/^#/, '').toLowerCase()
}

export function cycleTagFilterState(filters: TagFilterState, rawTag: string): TagFilterState {
  const tag = normalizeTagFilterValue(rawTag)
  if (!tag) return filters

  const current = filters[tag]
  const next = { ...filters }
  if (!current) {
    next[tag] = 'include'
  } else if (current === 'include') {
    next[tag] = 'exclude'
  } else {
    delete next[tag]
  }
  return next
}

export function hasActiveTagFilters(filters: TagFilterState): boolean {
  return Object.keys(filters).length > 0
}

export function itemMatchesTagFilters(tags: string[] | undefined, filters: TagFilterState): boolean {
  const entries = Object.entries(filters)
  if (entries.length === 0) return true

  const tagSet = new Set((tags ?? []).map(normalizeTagFilterValue).filter(Boolean))
  const includes = entries.filter(([, mode]) => mode === 'include').map(([tag]) => tag)
  const excludes = entries.filter(([, mode]) => mode === 'exclude').map(([tag]) => tag)

  if (includes.some((tag) => !tagSet.has(tag))) return false
  if (excludes.some((tag) => tagSet.has(tag))) return false
  return true
}

