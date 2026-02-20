import { motion } from 'framer-motion';
import React from 'react';

interface PixelRobotLoaderProps {
    mode?: 'LOADING' | 'SUCCESS';
}

export function PixelRobotLoader({ mode = 'LOADING' }: PixelRobotLoaderProps) {
    return (
        <div className="w-full h-48 relative flex items-center justify-center overflow-hidden bg-slate-50/50 rounded-2xl border border-slate-100">
            {mode === 'LOADING' ? (
                <>
                    {/* Chasing Scene Container */}
                    <motion.div
                        className="absolute flex items-center"
                        animate={{
                            x: [-100, 100, -100], // Longer run
                        }}
                        transition={{
                            duration: 7,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                    >
                        {/* 1. The Document (Flying Boomerang/Curved Path) */}
                        <motion.div
                            className="relative z-10 mr-8"
                            animate={{
                                y: [0, -40, 0], // Arc height
                                x: [0, 20, 0], // Forward arc
                                rotate: [-20, 10, -20]
                            }}
                            transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                        >
                            {/* Paper Icon with "Speed" blur effect */}
                            <div className="w-8 h-10 bg-white border-2 border-slate-300 rounded-sm shadow-sm flex flex-col items-center justify-center gap-1 origin-bottom-left transform -skew-x-6">
                                <div className="w-5 h-0.5 bg-slate-200"></div>
                                <div className="w-5 h-0.5 bg-slate-200"></div>
                                <div className="w-3 h-0.5 bg-slate-200 mr-2"></div>
                            </div>
                            {/* Boomerang Trail */}
                            <motion.div
                                className="absolute -right-4 top-1/2 w-8 h-1 bg-teal-200/50 rounded-full blur-[2px]"
                                animate={{ opacity: [0, 1, 0], width: [10, 40, 10] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                            />
                        </motion.div>

                        {/* 2. Dino-Croc Character (Chasing) */}
                        <motion.div
                            className="relative"
                            style={{ scaleX: -1 }}
                            animate={{
                                y: [0, -8, 0], // High energy bounce
                            }}
                            transition={{
                                duration: 0.3,
                                repeat: Infinity,
                                ease: "circOut"
                            }}
                        >
                            <DinoSvg />

                            {/* "Wait for me!" symbol */}
                            <motion.div
                                className="absolute -top-4 right-2 text-slate-800 text-[10px] font-bold bg-white px-1 rounded shadow-sm border border-slate-200"
                                animate={{ opacity: [0, 1, 1, 0], y: [0, -5, -5, 0] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                            >
                                !!!
                            </motion.div>
                        </motion.div>
                    </motion.div>

                    {/* Text Message */}
                    <div className="absolute bottom-6 text-center w-full">
                        <motion.p
                            className="text-slate-800 font-bold text-lg"
                        >
                            AI가 문서를 분석하고 있습니다...
                        </motion.p>
                        <div className="flex justify-center gap-1 mt-1">
                            <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce delay-0"></span>
                            <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce delay-100"></span>
                            <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce delay-200"></span>
                        </div>
                        <p className="text-slate-400 text-xs mt-2">약 3~5분이 소요됩니다. 창을 닫지 마세요.</p>
                    </div>
                </>
            ) : (
                <>
                    {/* SUCCESS MODE: Happy Dino holding paper */}
                    <div className="flex flex-col items-center justify-center relative z-10">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", bounce: 0.5 }}
                            className="relative"
                        >
                            {/* Heart Emojis popping */}
                            <motion.div
                                className="absolute -top-6 left-0 text-xl"
                                animate={{ y: [-10, -20, -10], opacity: [0, 1, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                            >
                                ❤️
                            </motion.div>
                            <motion.div
                                className="absolute -top-4 right-0 text-lg"
                                animate={{ y: [-5, -15, -5], opacity: [0, 1, 0] }}
                                transition={{ repeat: Infinity, duration: 1.2, delay: 0.3 }}
                            >
                                ✨
                            </motion.div>

                            {/* Happy Jumping Dino */}
                            <motion.div
                                animate={{ y: [0, -15, 0] }}
                                transition={{ repeat: Infinity, duration: 0.5, ease: "easeInOut" }}
                            >
                                <div className="relative">
                                    {/* Dino Facing Front/Left but Happy */}
                                    {/* Reuse SVG but modify slightly if needed (arms up) */}
                                    {/* Simply rotating arms in code below */}
                                    <DinoSvg isHappy />

                                    {/* Holding Paper */}
                                    <motion.div
                                        className="absolute top-4 -left-2 z-20"
                                        animate={{ rotate: [-5, 5, -5] }}
                                        transition={{ duration: 0.5, repeat: Infinity }}
                                    >
                                        <div className="w-6 h-8 bg-white border border-slate-200 shadow-sm flex flex-col items-center justify-center p-0.5 transform -rotate-12">
                                            <div className="w-full h-px bg-slate-200 my-0.5"></div>
                                            <div className="w-full h-px bg-slate-200 my-0.5"></div>
                                            <div className="w-2/3 h-px bg-slate-200 my-0.5 self-start"></div>
                                            <div className="absolute -right-1 -bottom-1 bg-teal-500 rounded-full w-3 h-3 flex items-center justify-center">
                                                <div className="w-1.5 h-1 border-b border-l border-white transform -rotate-45 -mt-0.5"></div>
                                            </div>
                                        </div>
                                    </motion.div>
                                </div>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="mt-6 text-center"
                        >
                            <h3 className="text-xl font-extrabold text-teal-600 mb-1">분석 완료!</h3>
                            <p className="text-slate-500 text-sm font-medium">견적서 작성 화면으로 이동합니다...</p>
                        </motion.div>
                    </div>

                    {/* Confetti / Sparkles Background */}
                    <Confetti />
                </>
            )}
        </div>
    );
}

function Confetti() {
    // Generate random positions once on mount (or use fixed distinct values)
    // Using fixed values to avoid hydration mismatch issues if this were SSR,
    // but for client-side simple animation, static random-looking values are fine.
    const particles = React.useMemo(() => [
        { x: -30, y: -40, color: '#FCD34D', delay: 0 },
        { x: 40, y: -30, color: '#F87171', delay: 0.1 },
        { x: -20, y: 30, color: '#34D399', delay: 0.2 },
        { x: 30, y: 40, color: '#60A5FA', delay: 0.3 },
        { x: -40, y: 0, color: '#FCD34D', delay: 0.4 },
        { x: 50, y: 10, color: '#F87171', delay: 0.5 },
    ], []); // Empty dependency array ensures this runs only once

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {particles.map((p, i) => (
                <motion.div
                    key={i}
                    className="absolute w-2 h-2 rounded-full"
                    initial={{ x: "50%", y: "50%", scale: 0 }}
                    animate={{
                        x: `${50 + p.x}%`,
                        y: `${50 + p.y}%`,
                        opacity: [1, 0],
                        scale: [0, 1]
                    }}
                    transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: p.delay,
                        repeatDelay: 0.5
                    }}
                    style={{ backgroundColor: p.color }}
                />
            ))}
        </div>
    );
}

function DinoSvg({ isHappy = false }: { isHappy?: boolean }) {
    return (
        <svg width="56" height="56" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Tail */}
            <path d="M4 16 L8 16 L8 20 L2 20 L2 18 L4 18 Z" className="fill-teal-600" />

            {/* Body & Legs */}
            <rect x="7" y="16" width="10" height="7" className="fill-teal-500" />
            <rect x="7" y="23" width="3" height="3" className="fill-teal-700" /> {/* Leg L */}
            <rect x="14" y="23" width="3" height="3" className="fill-teal-700" /> {/* Leg R */}

            {/* Head (Big Jaw) */}
            <rect x="8" y="6" width="14" height="11" className="fill-teal-500" />
            <rect x="18" y="10" width="8" height="6" className="fill-teal-500" /> {/* Snout Extension */}

            {/* Spikes / Crest */}
            <rect x="9" y="4" width="2" height="2" className="fill-teal-300" />
            <rect x="12" y="3" width="2" height="3" className="fill-teal-300" />
            <rect x="15" y="4" width="2" height="2" className="fill-teal-300" />

            {/* Eye (Cute) - Blink or Happy Eyes if isHappy? Let's keep it simple cute */}
            <rect x="12" y="8" width="3" height="3" className="fill-slate-900" />
            <rect x="13" y="8" width="1" height="1" className="fill-white" />

            {/* Mouth / Teeth */}
            <rect x="18" y="14" width="6" height="1" className="fill-white" /> {/* Teeth */}
            <rect x="18" y="15" width="4" height="1" className="fill-teal-800" /> {/* Mouth Line */}

            {/* Arms - Raise them if happy */}
            <motion.g
                animate={isHappy ? { rotate: -45, y: -2 } : { rotate: 0 }}
                style={{ originX: "20px", originY: "19px" }}
            >
                <motion.rect
                    x="18" y="18" width="4" height="2" className="fill-teal-400"
                    animate={!isHappy ? { rotate: [-20, 20, -20] } : {}}
                    transition={!isHappy ? { duration: 0.3, repeat: Infinity } : {}}
                    style={{ originX: 0 }}
                />
            </motion.g>
        </svg>
    );
}
