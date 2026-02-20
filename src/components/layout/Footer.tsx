import { Link, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';

export function Footer() {
    const location = useLocation();
    const isWelcomePage = location.pathname === '/' || location.pathname === '/welcome';

    if (!isWelcomePage) {
        return null;
    }

    return (
        <footer className="w-full bg-white border-t border-slate-200 py-10 relative z-50">
            <div className="mx-auto max-w-[1200px] px-4 flex flex-col md:flex-row justify-center items-center md:items-start gap-12">

                {/* Left: Logo */}
                <div className="flex-shrink-0">
                    <img
                        src={logo}
                        alt="AltF Logo"
                        className="h-32 w-auto"
                    />
                </div>

                {/* Center: Info Block */}
                <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-4">
                    {/* Links */}
                    <div className="flex gap-6 text-sm font-bold text-slate-800">
                        <Link to="/policy/terms" className="hover:text-primary-600">서비스 이용약관</Link>
                        <Link to="/policy/privacy" className="text-slate-900 hover:text-primary-600">개인정보 처리방침</Link>
                        <Link to="/policy/marketing" className="hover:text-primary-600">마케팅정보 수신동의</Link>
                    </div>

                    {/* Info Text */}
                    <div className="text-xs text-slate-500 leading-relaxed font-medium">
                        <p>
                            알트에프 대표 : 조현진 | 대표번호 : +82-51-303-3751 | 이메일 : airspace@altf.kr <br />
                            부산 본사 : 부산시 사상구 낙동대로1330번길 67
                        </p>
                        <p>
                            사업자등록번호 : 838-05-01054 | 통신판매업 신고번호 : 2020-부산사상구-0139호
                        </p>
                        <p className="mt-2 text-slate-400">
                            Copyright 2025. AltF, Co., Ltd. All rights reserved.
                        </p>
                    </div>
                </div>

            </div>
        </footer>
    );
}
