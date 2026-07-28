export type TagFilterMode = 'include' | 'exclude' | 'show-hidden'
export type TagFilterState = Record<string, TagFilterMode>

export function normalizeTagFilterValue(value: string): string {
  return String(value ?? '').trim().replace(/^#/, '').toLowerCase()
}

export function cycleTagFilterState(filters: TagFilterState, rawTag: string): TagFilterState {
  const tag = normalizeTagFilterValue(rawTag)
  if (!tag) return filters

  const current = filters[tag]
  const next = { ...filters }

  if (tag === 'hidden') {
    if (!current) {
      next[tag] = 'show-hidden'
    } else if (current === 'show-hidden') {
      next[tag] = 'include'
    } else {
      delete next[tag]
    }
  } else {
    if (!current) {
      next[tag] = 'include'
    } else if (current === 'include') {
      next[tag] = 'exclude'
    } else {
      delete next[tag]
    }
  }
  return next
}

export function hasActiveTagFilters(filters: TagFilterState): boolean {
  return Object.keys(filters).length > 0
}

export function itemMatchesTagFilters(tags: string[] | undefined, filters: TagFilterState): boolean {
  const tagSet = new Set((tags ?? []).map(normalizeTagFilterValue).filter(Boolean))

  // 1. By default, if the item has the 'hidden' tag, it is hidden
  // unless there is an active filter on 'hidden' (either 'show-hidden' or 'include')
  const hiddenMode = filters['hidden']
  if (tagSet.has('hidden')) {
    if (hiddenMode !== 'show-hidden' && hiddenMode !== 'include') {
      return false
    }
  }

  const entries = Object.entries(filters)
  const includes = entries.filter(([, mode]) => mode === 'include').map(([tag]) => tag)
  const excludes = entries.filter(([, mode]) => mode === 'exclude').map(([tag]) => tag)

  // If there are no include/exclude filters, the item matches
  if (includes.length === 0 && excludes.length === 0) {
    return true
  }

  if (includes.some((tag) => !tagSet.has(tag))) return false
  if (excludes.some((tag) => tagSet.has(tag))) return false
  return true
}

