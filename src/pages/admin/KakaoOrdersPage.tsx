import { KakaoOrderReviewTab } from '../../components/admin/KakaoOrderReviewTab';
import { ArrowLeft, Sparkles, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * 📋 [영업3팀] 카카오톡 발주 접수 대기 & 운송 확정 센터
 * 
 * [목적]
 * 영업담당자들에게 복잡한 전사 관제탑(altf office HUD)을 열어주지 않고도,
 * 고객이 카카오톡으로 보낸 발주서(사진/텍스트)를 단독 화면에서:
 * 1. 누가 발신했는지 (고객사명, 담당자, 연락처)
 * 2. 언제 발신했는지 (접수 일시)
 * 3. 수신 사진 원본 및 봇의 품목 판독 대조
 * 4. 화물 운송 관련 필수 사항(도착지, 운송비 조건) 1클릭 확정
 * 5. 정식 발주 승인 및 순차 발주번호 발급 -> 구매부(PUR-01/07) 안전 이첩
 * 6. SLE-15 발주서 수정관찰봇의 실시간 Diff 학습 및 규칙 정립 확인
 */
export default function KakaoOrdersPage() {
    const navigate = useNavigate();

    return (
        <div className="flex-1 flex flex-col h-full bg-[#0d0f15] text-slate-100 overflow-hidden font-pretendard">
            {/* Top Navigation Bar */}
            <div className="h-14 border-b border-gray-800 bg-[#12141c] px-6 flex items-center justify-between flex-shrink-0 z-10 shadow-md">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/admin/orders')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-all border border-gray-700"
                        title="주문 관리 원장으로 돌아가기"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>주문 관리로 복귀</span>
                    </button>

                    <div className="h-4 w-px bg-gray-700 mx-1" />

                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <Truck className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-sm font-bold text-white tracking-wide">
                                    [영업3팀] 카카오톡 발주 접수 대기 & 운송 확정 센터
                                </h1>
                                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-mono font-bold">
                                    HUMAN-IN-THE-LOOP
                                </span>
                            </div>
                            <p className="text-[11px] text-gray-400">
                                사진·품목 대조 ➔ 화물 도착지·운송비 확정 ➔ 정식 발주서(db.orders) 즉시 등록 및 구매부(PUR-01/07) 이첩
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2.5 py-1 rounded-lg">
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        <span>SLE-15 수정 학습 봇 실시간 가동 중</span>
                    </span>
                </div>
            </div>

            {/* Main Interactive Ingestion & Verification Queue Component */}
            <div className="flex-1 flex overflow-hidden">
                <KakaoOrderReviewTab />
            </div>
        </div>
    );
}
