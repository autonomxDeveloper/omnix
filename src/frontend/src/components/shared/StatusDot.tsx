import { cn } from '@/lib/utils'

interface StatusDotProps {
  status: 'connected' | 'disconnected' | 'loading'
  label?: string
  className?: string
}

export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div
        className={cn(
          'h-2 w-2 rounded-full',
          status === 'connected' && 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]',
          status === 'disconnected' && 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]',
          status === 'loading' && 'bg-yellow-500 animate-pulse',
        )}
      />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  )
}
