import { cn } from '../../lib/utils';
import type { BadgeColor } from './badge-utils';

interface BadgeProps {
    color?: BadgeColor;
    children: React.ReactNode;
    className?: string;
}

export function Badge({ color = 'default', children, className }: BadgeProps) {
    const styles = {
        default: 'bg-slate-100 text-slate-800',
        mint: 'bg-primary-100 text-primary-800',
        blue: 'bg-blue-100 text-blue-800',
        purple: 'bg-purple-100 text-purple-800',
        orange: 'bg-orange-100 text-orange-800',
        teal: 'bg-teal-100 text-teal-800',
        amber: 'bg-amber-100 text-amber-800',
        slate: 'bg-slate-100 text-slate-800',
        red: 'bg-red-100 text-red-800',
        yellow: 'bg-yellow-100 text-yellow-800',
    };

    return (
        <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', styles[color], className)}>
            {children}
        </span>
    );
}


