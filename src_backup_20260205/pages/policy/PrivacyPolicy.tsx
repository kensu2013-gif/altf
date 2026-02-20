import { CalmPageShell } from '../../components/ui/CalmPageShell';

export default function PrivacyPolicy() {
    return (
        <CalmPageShell>
            <div className="mb-8 text-center sm:text-left">
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">개인정보 처리방침</h1>
                <p className="text-slate-500 mt-2 font-medium">고객님의 소중한 개인정보를 안전하게 보호합니다.</p>
            </div>
            <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-200 p-8 text-slate-700 leading-relaxed text-sm space-y-8">

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">1. 개인정보처리방침의 의의</h2>
                    <p> 알트에프(ALT.F)(이하 "회사")는 본 개인정보처리방침을 통하여 이용자 여러분이 제공하시는 개인정보가 어떠한 용도와 방식으로 이용되고 있으며 개인정보보호를 위해 어떠한 조치가 취해지고 있는지 알려드립니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">2. 수집하는 개인정보의 항목 및 수집방법</h2>
                    <p className="mb-2">회사는 회원가입, 상담, 서비스 신청 등을 위해 아래와 같은 개인정보를 수집하고 있습니다.</p>
                    <ul className="list-disc pl-5 space-y-2 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <li><strong>수집항목:</strong> 회사명, 사업자등록번호, 대표자명, 담당자명, 아이디(이메일), 비밀번호, 휴대전화번호, 주소, 팩스번호(선택), 서비스 이용기록, 접속 로그, 쿠키, 접속 IP 정보</li>
                        <li><strong>수집방법:</strong> 홈페이지(회원가입), 서면양식, 팩스, 전화, 상담 게시판, 이메일</li>
                    </ul>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">3. 개인정보의 수집 및 이용목적</h2>
                    <p>회사는 수집한 개인정보를 다음의 목적을 위해 활용합니다.</p>
                    <ul className="list-disc pl-5 space-y-1 mt-2">
                        <li><strong>서비스 제공에 관한 계약 이행 및 요금정산:</strong> 콘텐츠 제공, 구매 및 요금 결제, 물품배송 또는 청구지 등 발송</li>
                        <li><strong>회원 관리:</strong> 회원제 서비스 이용에 따른 본인확인, 개인 식별, 가입 의사 확인, 불만처리 등 민원처리, 고지사항 전달</li>
                        <li><strong>마케팅 및 광고에 활용 (동의 시):</strong> 신규 서비스(제품) 개발 및 특화, 이벤트 등 광고성 정보 전달</li>
                    </ul>
                </section>

                {/* Third-party provision excluded as requested */}
                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">4. 개인정보의 제3자 제공 및 위탁</h2>
                    <p className="text-teal-600 font-bold bg-teal-50 p-4 rounded-lg inline-block w-full">
                        회사는 이용자의 개인정보를 원칙적으로 외부에 제공하거나 위탁하지 않습니다.
                    </p>
                    <p className="mt-2 text-slate-500 text-xs">
                        다만, 법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우는 예외로 합니다.<br />
                        또한, 향후 AWS(Amazon Web Services) 등 클라우드 인프라 사용 시, 데이터 저장을 위한 기술적 위탁이 발생할 수 있으며, 이 경우 본 방침을 통해 사전 고지하겠습니다.
                    </p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">5. 개인정보의 보유 및 이용기간</h2>
                    <p>회사는 개인정보 수집 및 이용목적이 달성된 후에는 예외 없이 해당 정보를 파기합니다. 단, 상법 등 관련 법령의 규정에 의하여 다음과 같이 거래 관련 권리 의무 관계의 확인 등을 이유로 일정기간 보유하여야 할 필요가 있는 경우, 명시한 기간 동안 보유합니다.</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                        <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
                        <li>대금결제 및 재화 등의 공급에 관한 기록: 5년</li>
                        <li>소비자의 불만 또는 분쟁처리에 관한 기록: 3년</li>
                    </ul>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">6. 개인정보의 파기절차 및 방법</h2>
                    <p>회사는 원칙적으로 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체없이 파기합니다.</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                        <li><strong>파기절차:</strong> 회원가입 등을 위해 입력하신 정보는 목적이 달성된 후 별도의 DB로 옮겨져(종이의 경우 별도의 서류함) 내부 방침 및 기타 관련 법령에 의한 정보보호 사유에 따라(보유 및 이용기간 참조) 일정 기간 저장된 후 파기됩니다.</li>
                        <li><strong>파기방법:</strong> 전자적 파일형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제합니다.</li>
                    </ul>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">7. 이용자 및 법정대리인의 권리와 행사방법</h2>
                    <p>이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나 수정할 수 있으며 가입해지를 요청할 수 있습니다.</p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-slate-900 mb-4">8. 개인정보 보호책임자</h2>
                    <p className="mb-2">회사는 고객의 개인정보를 보호하고 개인정보와 관련한 불만을 처리하기 위하여 아래와 같이 관련 부서 및 개인정보보호책임자를 지정하고 있습니다.</p>
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <p><strong>개인정보 보호책임자:</strong> 조현진 대표</p>
                        <p><strong>전화번호:</strong> +82-51-303-3751</p>
                        <p><strong>이메일:</strong> airspace@altf.kr</p>
                    </div>
                </section>

                <div className="text-center pt-8 text-slate-400 text-xs">
                    <p>공고일자: 2026년 2월 3일</p>
                    <p>시행일자: 2026년 2월 10일</p>
                </div>
            </div>
        </CalmPageShell>
    );
}
