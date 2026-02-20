import { CalmPageShell } from '../../components/ui/CalmPageShell';

export default function MarketingConsent() {
    return (
        <CalmPageShell>
            <div className="mb-8 text-center sm:text-left">
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">마케팅 정보 수신동의</h1>
                <p className="text-slate-500 mt-2 font-medium">다양한 혜택과 소식을 가장 먼저 받아보세요.</p>
            </div>
            <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-200 p-8 text-slate-700 leading-relaxed text-sm space-y-8">

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4 uppercase text-teal-600">선택 개인정보 수집 및 이용</h2>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse border border-slate-200 rounded-lg hidden md:table">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="p-4 border border-slate-200 text-xs font-bold text-slate-600 w-1/4">수집 항목</th>
                                    <th className="p-4 border border-slate-200 text-xs font-bold text-slate-600 w-1/2">수집 및 이용 목적</th>
                                    <th className="p-4 border border-slate-200 text-xs font-bold text-slate-600 w-1/4">보유 및 이용 기간</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="p-4 border border-slate-200">휴대전화번호, 이메일, 이름, 회사명</td>
                                    <td className="p-4 border border-slate-200">
                                        <ul className="list-disc pl-4 space-y-1">
                                            <li>새로운 제품 및 서비스 안내</li>
                                            <li>이벤트 및 광고성 정보 제공</li>
                                            <li>서비스 관련 주요 소식 전달</li>
                                        </ul>
                                    </td>
                                    <td className="p-4 border border-slate-200 font-bold text-red-500">
                                        동의 철회 또는 회원 탈퇴 시까지
                                    </td>
                                </tr>
                            </tbody>
                        </table>

                        {/* Mobile View */}
                        <div className="md:hidden space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                            <div>
                                <h4 className="font-bold text-xs text-slate-500 mb-1">수집 항목</h4>
                                <p>휴대전화번호, 이메일, 이름, 회사명</p>
                            </div>
                            <div className="border-t border-slate-200 pt-3">
                                <h4 className="font-bold text-xs text-slate-500 mb-1">수집 및 이용 목적</h4>
                                <p>제품/서비스 안내, 이벤트/광고성 정보 제공</p>
                            </div>
                            <div className="border-t border-slate-200 pt-3">
                                <h4 className="font-bold text-xs text-slate-500 mb-1">보유 및 이용 기간</h4>
                                <p className="font-bold text-red-500">동의 철회 또는 회원 탈퇴 시까지</p>
                            </div>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="bg-amber-50 border border-amber-100 p-5 rounded-xl flex items-start gap-3">
                        <div className="text-amber-500 mt-1">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-bold text-amber-900 mb-1">동의를 거부할 권리</h3>
                            <p className="text-xs text-amber-800 leading-relaxed">
                                귀하는 마케팅 정보 수신에 대한 동의를 거부할 권리가 있으며, 동의를 거부하더라도 기본 서비스 이용에는 제한이 없습니다.<br />
                                다만, 동의 거부 시 이벤트 및 다양한 혜택 안내를 받으실 수 없습니다.
                            </p>
                        </div>
                    </div>
                </section>

                <div className="text-center pt-4 text-slate-400 text-xs">
                    <p>전송자: 알트에프(ALT.F) (부산시 사상구 낙동대로1330번길 67)</p>
                </div>
            </div>
        </CalmPageShell>
    );
}
