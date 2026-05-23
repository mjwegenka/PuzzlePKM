import React from 'react'
import { Chip, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CloseIcon from '@mui/icons-material/Close'

interface FilterChipProps {
  icon?: React.ReactElement
  label: string
  selected?: boolean
  showCaret?: boolean
  onToggle?: () => void
  onDismiss?: () => void
}

export default function FilterChip({
  icon,
  label,
  selected = false,
  showCaret = false,
  onToggle,
  onDismiss,
}: FilterChipProps) {
  return (
    <Chip
      size="small"
      icon={icon}
      clickable={Boolean(onToggle)}
      onClick={onToggle}
      onDelete={onDismiss}
      deleteIcon={onDismiss ? <CloseIcon sx={{ fontSize: 14, color: 'text.disabled !important' }} /> : undefined}
      label={(
        <Stack direction="row" spacing={0.2} alignItems="center">
          <Typography component="span" sx={{ fontSize: '11px', fontWeight: 500 }}>
            {label}
          </Typography>
          {showCaret && !onDismiss && <KeyboardArrowDownIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
        </Stack>
      )}
      sx={(theme) => ({
        height: 24,
        borderRadius: '999px',
        color: selected ? theme.palette.text.primary : theme.palette.text.secondary,
        bgcolor: selected ? alpha(theme.palette.common.white, 0.08) : theme.palette.surface.sunken,
        border: `1px solid ${selected ? theme.palette.border.strong : theme.palette.border.subtle}`,
        '& .MuiChip-icon': {
          fontSize: 13,
          color: selected ? theme.palette.text.secondary : theme.palette.text.disabled,
          ml: 0.6,
        },
        '& .MuiChip-label': { px: 0.75 },
        '&:hover': {
          bgcolor: selected ? alpha(theme.palette.common.white, 0.12) : theme.palette.surface.elevated,
          borderColor: theme.palette.border.strong,
        },
      })}
    />
  )
}
