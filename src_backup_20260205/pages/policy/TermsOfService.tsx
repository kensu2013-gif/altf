import { CalmPageShell } from '../../components/ui/CalmPageShell';

export default function TermsOfService() {
    return (
        <CalmPageShell>
            <div className="mb-8 text-center sm:text-left">
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">서비스 이용약관</h1>
                <p className="text-slate-500 mt-2 font-medium">AltF 서비스 이용을 위한 약관입니다.</p>
            </div>
            <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-200 p-8 text-slate-700 leading-relaxed text-sm space-y-8">

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 1 조 (목적)</h2>
                    <p>이 약관은 <strong>알트에프(ALT.F)</strong>(이하 "회사")가 제공하는 제반 서비스의 이용과 관련하여 회사와 회원 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 2 조 (용어의 정의)</h2>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>"서비스"라 함은 구현되는 단말기와 상관없이 "회원"이 이용할 수 있는 알트에프 및 알트에프 관련 제반 서비스를 의미합니다.</li>
                        <li>"회원"이라 함은 회사의 "서비스"에 접속하여 이 약관에 따라 "회사"와 이용계약을 체결하고 "회사"가 제공하는 "서비스"를 이용하는 고객을 말합니다.</li>
                        <li>"아이디(ID)"라 함은 "회원"의 식별과 "서비스" 이용을 위하여 "회원"이 정하고 "회사"가 승인하는 문자와 숫자의 조합을 의미합니다.</li>
                        <li>"비밀번호"라 함은 "회원"이 부여 받은 "아이디와 일치되는 "회원"임을 확인하고 비밀보호를 위해 "회원" 자신이 정한 문자 또는 숫자의 조합을 의미합니다.</li>
                    </ul>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 3 조 (약관의 게시와 개정)</h2>
                    <ol className="list-decimal pl-5 space-y-2">
                        <li>"회사"는 이 약관의 내용을 "회원"이 쉽게 알 수 있도록 서비스 초기 화면에 게시합니다.</li>
                        <li>"회사"는 "약관의 규제에 관한 법률", "정보통신망 이용촉진 및 정보보호 등에 관한 법률" 등 관련법을 위배하지 않는 범위에서 이 약관을 개정할 수 있습니다.</li>
                        <li>"회사"가 약관을 개정할 경우에는 적용일자 및 개정사유를 명시하여 현행약관과 함께 제1항의 방식에 따라 적용일자 전일까지 공지합니다.</li>
                    </ol>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 4 조 (이용계약 체결)</h2>
                    <p>이용계약은 "회원"이 되고자 하는 자(이하 "가입신청자")가 약관의 내용에 대하여 동의를 한 다음 회원가입신청을 하고 "회사"가 이러한 신청에 대하여 승낙함으로써 체결됩니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 5 조 (회원정보의 변경)</h2>
                    <p>"회원"은 개인정보관리화면을 통하여 언제든지 본인의 개인정보를 열람하고 수정할 수 있습니다. 다만, 서비스 관리를 위해 필요한 실명, 아이디 등은 수정이 불가능합니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 6 조 (개인정보보호 의무)</h2>
                    <p>"회사"는 "정보통신망법" 등 관계 법령이 정하는 바에 따라 "회원"의 개인정보를 보호하기 위해 노력합니다. 개인정보의 보호 및 사용에 대해서는 관련법 및 "회사"의 개인정보처리방침이 적용됩니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 7 조 (회원의 아이디 및 비밀번호의 관리에 대한 의무)</h2>
                    <p>제6조의 경우를 제외한 아이디와 비밀번호에 관한 관리책임은 "회원"에게 있습니다. "회원"은 자신의 아이디 및 비밀번호를 제3자에게 이용하게 해서는 안 됩니다.</p>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 8 조 (회사의 의무)</h2>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>"회사"는 관련법과 이 약관이 금지하거나 미풍양속에 반하는 행위를 하지 않으며, 계속적이고 안정적으로 "서비스"를 제공하기 위하여 최선을 다하여 노력합니다.</li>
                        <li>"회사"는 "회원"이 안전하게 "서비스"를 이용할 수 있도록 개인정보보호를 위한 보안 시스템을 갖추어야 하며 개인정보처리방침을 공시하고 준수합니다.</li>
                    </ul>
                </section>

                <section className="border-b border-slate-100 pb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 9 조 (회원의 의무)</h2>
                    <p>"회원"은 다음 행위를 하여서는 안 됩니다.</p>
                    <ul className="list-disc pl-5 space-y-1 mt-2">
                        <li>신청 또는 변경 시 허위내용의 등록</li>
                        <li>타인의 정보도용</li>
                        <li>"회사"가 게시한 정보의 변경</li>
                        <li>"회사"와 기타 제3자의 저작권 등 지적재산권에 대한 침해</li>
                        <li>"회사" 및 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-slate-900 mb-4">제 10 조 (서비스의 중단)</h2>
                    <p>"회사"는 컴퓨터 등 정보통신설비의 보수점검, 교체 및 고장, 통신두절 또는 운영상 상당한 이유가 있는 경우 "서비스"의 제공을 일시적으로 중단할 수 있습니다.</p>
                </section>

                <div className="text-center pt-8 text-slate-400 text-xs">
                    <p>공고일자: 2026년 2월 3일</p>
                    <p>시행일자: 2026년 2월 10일</p>
                </div>
            </div>
        </CalmPageShell>
    );
}
