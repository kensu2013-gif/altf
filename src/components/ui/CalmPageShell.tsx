import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CalmPageShellProps {
    children: ReactNode;
    className?: string; // Content wrapper className
}

export function CalmPageShell({ children, className = '' }: CalmPageShellProps) {
    return (
        <div className="relative min-h-[calc(100vh-64px)] w-full font-pretendard overflow-hidden">
            {/* 
              Layer 1: Background Base (Slate Gradient)
              Subtle dark/industrial tone but kept light enough for readability if needed, 
              or dark if preferred. User asked for "calm industrial... slate-950 to slate-900".
            */}
            {/* 
              Layer 1: Background Base (Light Slate Gradient)
              Changed from dark to light as per user feedback to eliminate black flashing during transitions.
            */}
            <div className="fixed inset-0 -z-30 bg-gradient-to-br from-slate-50 via-slate-100 to-white" />

            {/* Layer 2: Image Overlay (Very Low Opacity for Texture) */}
            <div
                className="fixed inset-0 -z-20 bg-calm-pipes bg-cover bg-center bg-no-repeat opacity-[0.03] saturate-0"
            />

            {/* Layer 3: Radial Spotlight (Top Center - Subtle Light Glow) */}
            <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white via-transparent to-transparent opacity-80" />

            {/* Layer 4: Noise Overlay (Subtle Grain) */}
            <div className="fixed inset-0 -z-10 bg-noise-texture opacity-[0.4] pointer-events-none mix-blend-overlay" />

            {/* Content Container with Mount Animation */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={`relative z-10 mx-auto w-full max-w-[1400px] px-4 py-8 ${className}`}
            >
                {children}
            </motion.div>
        </div>
    );
}
