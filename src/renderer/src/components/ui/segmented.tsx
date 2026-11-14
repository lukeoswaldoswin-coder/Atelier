import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** 小型分段选择器（无截止 / 仅日期 / 日期+时间；未报价 / 免费 / 金额）。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false
}: {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (next: T) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-fit items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded px-2.5 py-1 text-xs transition-colors',
              active
                ? 'bg-card font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
