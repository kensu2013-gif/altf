import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { PixelRobotLoader } from './PixelRobotLoader';
import { X, Maximize2 } from 'lucide-react';

export function GlobalUploadIndicator() {
    const { uploadState, setUploadStatus } = useStore();
    const location = useLocation();
    const navigate = useNavigate();
    const isProcessing = uploadState.status === 'PROCESSING';
    const isDone = uploadState.status === 'DONE';

    // Verify if we are on the Search page. 
    // If on Search page, the main page component handles the full-size loader.
    // So we hide this mini-player.
    const isSearchPage = location.pathname === '/search';

    if ((!isProcessing && !isDone) || isSearchPage) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.9 }}
                className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden ring-1 ring-slate-900/5"
            >
                {/* Header */}
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-teal-500 animate-pulse' : 'bg-green-500'}`} />
                        <span className="text-xs font-bold text-slate-700">
                            {isProcessing ? 'AI 분석 실행 중...' : '분석 완료'}
                        </span>
                    </div>
                    <div className="flex gap-1">
                        <button
                            onClick={() => navigate('/search')}
                            className="p-1 hover:bg-slate-200 rounded text-slate-500"
                            title="전체 화면으로 보기"
                        >
                            <Maximize2 size={14} />
                        </button>
                        {isDone && (
                            <button
                                onClick={() => setUploadStatus('IDLE')}
                                className="p-1 hover:bg-red-100 hover:text-red-500 rounded text-slate-400"
                                title="닫기"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Content - Scaled down Loader */}
                <div className="p-2 bg-slate-50/50">
                    <div className="transform scale-[0.6] origin-top -mb-16 -mt-8">
                        <PixelRobotLoader mode={isDone ? 'SUCCESS' : 'LOADING'} />
                    </div>
                </div>

                {/* Footer Info */}
                <div className="px-4 py-2 bg-white border-t border-slate-100">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium">
                        <span>{uploadState.processedCount}개 항목 발견</span>
                        {isProcessing && <span>분석중...</span>}
                        {isDone && <span className="text-teal-600 font-bold cursor-pointer" onClick={() => navigate('/quote')}>견적서 확인하기 &rarr;</span>}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
