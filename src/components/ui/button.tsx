import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-[10px] border border-transparent text-sm font-medium transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  {
    variants: {
      variant: {
        default: 'border-primary/60 bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16)] hover:bg-primary/92',
        destructive: 'border-destructive/60 bg-destructive text-white shadow-[0_4px_12px_rgba(0,0,0,0.14)] hover:bg-destructive/90',
        outline: 'border-border bg-[var(--color-surface-control)]/88 text-foreground shadow-none hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
        secondary: 'border-border bg-secondary/85 text-secondary-foreground shadow-none hover:bg-secondary',
        ghost: 'text-muted-foreground shadow-none hover:border-border/80 hover:bg-[var(--color-surface-hover)] hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-9 rounded-[11px] px-4 text-xs',
        lg: 'h-11 rounded-[12px] px-6',
        icon: 'h-11 w-11 rounded-[11px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'

    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button }
