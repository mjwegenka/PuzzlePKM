import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'flex items-start gap-3 rounded-[12px] border px-3.5 py-2.5 text-sm',
  {
    variants: {
      variant: {
        default: 'border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-primary)]',
        info: 'border-[rgba(227,179,65,0.24)] bg-[rgba(227,179,65,0.10)] text-[var(--color-text-primary)]',
        success: 'border-[rgba(135,180,135,0.34)] bg-[rgba(135,180,135,0.12)] text-[var(--color-text-primary)]',
        warning: 'border-[rgba(242,203,99,0.28)] bg-[rgba(242,203,99,0.10)] text-[var(--color-text-primary)]',
        destructive: 'border-[rgba(226,89,89,0.34)] bg-[rgba(226,89,89,0.12)] text-[var(--color-text-primary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const iconMap = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: AlertCircle,
} satisfies Record<NonNullable<VariantProps<typeof alertVariants>['variant']>, React.ComponentType<{ className?: string }>>

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string
}

export function Alert({ className, variant = 'default', title, children, ...props }: AlertProps) {
  const resolvedVariant = variant ?? 'default'
  const Icon = iconMap[resolvedVariant]

  return (
    <div role="alert" className={cn(alertVariants({ variant: resolvedVariant }), className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
      <div className="min-w-0 flex-1">
        {title ? <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{title}</div> : null}
        <div className={cn('min-w-0', title ? 'mt-1' : '')}>{children}</div>
      </div>
    </div>
  )
}

