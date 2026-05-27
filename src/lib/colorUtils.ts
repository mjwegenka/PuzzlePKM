export function withAlpha(color: string, alpha: number): string {
  const normalized = String(color).trim()

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1)
    const isShort = hex.length === 3 || hex.length === 4
    const isLong = hex.length === 6 || hex.length === 8

    if (isShort || isLong) {
      const expanded = isShort
        ? hex
            .slice(0, 3)
            .split('')
            .map((value) => value + value)
            .join('')
        : hex.slice(0, 6)
      const r = Number.parseInt(expanded.slice(0, 2), 16)
      const g = Number.parseInt(expanded.slice(2, 4), 16)
      const b = Number.parseInt(expanded.slice(4, 6), 16)
      if ([r, g, b].every((value) => Number.isFinite(value))) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
    }
  }

  if (normalized.startsWith('rgb(')) {
    return normalized.replace(/^rgb\((.+)\)$/i, `rgba($1, ${alpha})`)
  }

  if (normalized.startsWith('rgba(')) {
    return normalized.replace(/rgba\(([^)]+),\s*[^,]+\)$/i, `rgba($1, ${alpha})`)
  }

  return normalized
}

