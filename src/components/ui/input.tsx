import { TextField } from '@mui/material'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean
}

export function Input({ className, ...props }: InputProps) {
  const { type, size, maxLength, fullWidth = true, ...rest } = props
  const mergedClassName = ['app-no-drag', className].filter(Boolean).join(' ')
  return (
    <TextField
      size="small"
      type={type}
      className={mergedClassName}
      fullWidth={fullWidth}
      inputProps={{
        ...(typeof size === 'number' ? { size } : {}),
        ...(typeof maxLength === 'number' ? { maxLength } : {}),
      }}
      {...(rest as object)}
    />
  )
}
