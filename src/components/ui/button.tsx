import type { ButtonProps as MuiButtonProps, IconButtonProps } from '@mui/material'
import { Button as MuiButton, IconButton } from '@mui/material'

type Variant = 'default' | 'destructive' | 'outline' | 'ghost' | 'active'
type Size = 'default' | 'sm' | 'lg' | 'icon'

export interface ButtonProps extends Omit<MuiButtonProps, 'variant' | 'size'> {
  variant?: Variant
  size?: Size
}

const SIZE_MAP: Record<Exclude<Size, 'icon'>, MuiButtonProps['size']> = {
  default: 'small',
  sm: 'small',
  lg: 'medium',
}

function getButtonVariant(variant: Variant): MuiButtonProps['variant'] {
  if (variant === 'outline') return 'outlined'
  if (variant === 'ghost') return 'text'
  return 'contained'
}

function getButtonColor(variant: Variant): MuiButtonProps['color'] {
  if (variant === 'destructive') return 'error'
  if (variant === 'active') return 'secondary'
  return 'primary'
}

export function Button({ className, variant = 'default', size = 'default', color, children, ...props }: ButtonProps) {
  const resolvedColor = color ?? getButtonColor(variant)

  if (size === 'icon') {
    const iconProps = props as Omit<IconButtonProps, 'size' | 'color'>
    return (
      <IconButton
        {...iconProps}
        className={`app-no-drag ${className ?? ''}`}
        size="small"
        color={resolvedColor}
      >
        {children}
      </IconButton>
    )
  }

  return (
    <MuiButton
      {...props}
      className={`app-no-drag ${className ?? ''}`}
      size={SIZE_MAP[size]}
      variant={getButtonVariant(variant)}
      color={resolvedColor}
    >
      {children}
    </MuiButton>
  )
}
