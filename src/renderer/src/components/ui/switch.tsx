import type { ComponentProps } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        'data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-3 rounded-full bg-background transition-transform',
          'data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-[13px]'
        )}
      />
    </SwitchPrimitive.Root>
  )
}
