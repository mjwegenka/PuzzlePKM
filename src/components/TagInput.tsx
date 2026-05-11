import { useMemo } from 'react'
import { Autocomplete, Chip, TextField } from '@mui/material'
import type { Tag } from '../shared/types'
import { useNotesStore } from '../store/notesStore'

interface TagInputProps {
  value: string[]
  onChange: (tagIds: string[]) => void
}

export default function TagInput({ value, onChange }: TagInputProps) {
  const { tags } = useNotesStore()

  const selectedTags = useMemo(
    () => value.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as Tag[],
    [tags, value],
  )

  const availableTags = useMemo(
    () => tags.filter((tag) => !value.includes(tag.id)),
    [tags, value],
  )

  const ensureTag = async (item: string | Tag): Promise<Tag | null> => {
    if (typeof item !== 'string') return item

    const normalized = item.trim().toLowerCase()
    if (!normalized) return null

    const existing = tags.find((tag) => tag.name === normalized)
    if (existing) return existing

    const result = await window.dropith.tag.create({
      id: crypto.randomUUID(),
      displayName: item.trim(),
      createdAt: new Date().toISOString(),
    })
    if (!result.success || !result.data) return null

    useNotesStore.getState().addTag(result.data)
    return result.data
  }

  return (
    <Autocomplete<Tag, true, false, true>
      multiple
      freeSolo
      className="app-no-drag"
      options={availableTags}
      value={selectedTags}
      filterSelectedOptions
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.displayName)}
      isOptionEqualToValue={(option, selected) => typeof selected !== 'string' && option.id === selected.id}
      onChange={async (_, newValue) => {
        try {
          const resolved = await Promise.all(newValue.map(ensureTag))
          const ids = resolved.filter((tag): tag is Tag => tag !== null).map((tag) => tag.id)
          onChange(ids)
        } catch {
          onChange(selectedTags.map((tag) => tag.id))
        }
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={typeof option === 'string' ? option : option.id}
            label={`#${typeof option === 'string' ? option : option.displayName}`}
            size="small"
            color="primary"
            variant="outlined"
          />
        ))
      }
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder={selectedTags.length === 0 ? 'Add tags…' : ''}
        />
      )}
    />
  )
}
