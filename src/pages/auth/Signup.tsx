import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { Building2, FileText, User, MapPin, Phone, Printer, Mail, Lock, Upload, ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { InteractiveBackground } from '../../components/ui/InteractiveBackground';
import { LoginWidgets } from '../../components/ui/LoginWidgets';
import { AlertDialog } from '../../components/ui/AlertDialog';
import { AddressSearchModal } from '../../components/ui/AddressSearchModal';
import { validateFileSignature, sanitizeInput } from '../../lib/security';

export default function Signup() {
    const navigate = useNavigate();
    const signup = useStore((state) => state.signup);

    const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        companyName: '',
        bizNo: '',
        contactName: '',
        address: '',
        phone: '',
        fax: '',
        email: '',
        password: '',
    });

    const [agreements, setAgreements] = useState({
        terms: false,
        privacy: false,
        marketing: false,
    });

    const handleAgreementChange = (key: keyof typeof agreements) => {
        setAgreements(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleAllAgreements = (checked: boolean) => {
        setAgreements({
            terms: checked,
            privacy: checked,
            marketing: checked,
        });
    };

    // Mock file state
    const [fileName, setFileName] = useState<string | null>(null);

    // Alert State
    const [alertState, setAlertState] = useState<{
        isOpen: boolean;
        title: string;
        description: React.ReactNode;
        type: 'success' | 'error' | 'info';
        onCloseCallback?: () => void;
    }>({
        isOpen: false,
        title: '',
        description: '',
        type: 'info'
    });

    const closeAlert = () => {
        setAlertState(prev => ({ ...prev, isOpen: false }));
        if (alertState.onCloseCallback) {
            alertState.onCloseCallback();
        }
    };

    const showAlert = (title: string, description: React.ReactNode, type: 'success' | 'error' | 'info', callback?: () => void) => {
        setAlertState({
            isOpen: true,
            title,
            description,
            type,
            onCloseCallback: callback
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        let newValue = value;

        if (name === 'bizNo') {
            // Remove non-numeric characters
            const numbers = value.replace(/\D/g, '');
            // Format as xxx-xx-xxxxx
            if (numbers.length <= 3) {
                newValue = numbers;
            } else if (numbers.length <= 5) {
                newValue = `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
            } else {
                newValue = `${numbers.slice(0, 3)}-${numbers.slice(3, 5)}-${numbers.slice(5, 10)}`;
            }
        } else {
            // General Input Sanitization (XSS Prevention)
            newValue = sanitizeInput(value);
        }

        setFormData(prev => ({ ...prev, [name]: newValue }));
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];

            // 1. Size Check (Max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                showAlert('파일 크기 초과', '파일 크기는 5MB 이하여야 합니다.', 'error');
                e.target.value = ''; // Reset input
                return;
            }

            // 2. Magic Number Check (Strict Security)
            const isValid = await validateFileSignature(file, ['image/jpeg', 'image/png', 'application/pdf']);
            if (!isValid) {
                showAlert('보안 위협 감지', '허용되지 않는 파일 형식입니다. (위변조된 파일일 수 있습니다)', 'error');
                e.target.value = ''; // Reset input
                return;
            }

            setFileName(file.name);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!agreements.terms || !agreements.privacy) {
            showAlert('약관 동의 필요', '서비스 이용약관 및 개인정보 처리방침에 동의해주세요.', 'error');
            return;
        }

        // 1. Attempt to create user first (validates duplicate email)
        const success = signup({
            ...formData,
            agreedToTerms: agreements.terms,
            agreedToPrivacy: agreements.privacy,
            agreedToMarketing: agreements.marketing,
            consentDate: new Date().toISOString()
        });

        if (!success) {
            showAlert('가입 제한', '이미 가입된 이메일입니다.', 'error');
            return;
        }

        // 2. If successful, send data to Make.com Webhook
        try {
            await fetch('https://hook.us2.make.com/gbl5jn6tp0gs79djk8ee0tlp5in53jxb', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...formData,
                    attachedFile: fileName
                }),
            });
        } catch (error) {
            console.error('Webhook error:', error);
            // Continue even if webhook fails
        }

        showAlert(
            '가입 신청 완료',
            <>회원가입 신청이 완료되었습니다.<br />관리자 승인 후 서비스를 이용하실 수 있습니다.</>,
            'success',
            () => navigate('/login')
        );
    };

    return (
        <div className="min-h-screen min-w-[320px] flex flex-col items-center justify-center font-pretendard relative overflow-y-auto overflow-x-hidden py-12 px-4 sm:px-6 lg:px-8">
            <InteractiveBackground />
            <LoginWidgets showClock={false} />

            <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-white/20 relative z-10 animate-in fade-in zoom-in duration-700">
                <div className="px-8 py-10 sm:px-12 space-y-8">
                    <div className="text-center space-y-3">
                        <h1 className="text-3xl font-extrabold text-white tracking-tight drop-shadow-md">회원가입</h1>
                        <p className="text-blue-50/80 text-sm font-medium">더 정확한 견적 서비스를 위해 사업자 정보를 입력해주세요.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        {/* Section 1: User Info */}
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold text-teal-300 uppercase tracking-wider border-b border-white/10 pb-2">계정 정보</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormInput
                                    label="이메일"
                                    name="email"
                                    type="email"
                                    icon={Mail}
                                    value={formData.email}
                                    onChange={handleChange}
                                    required
                                    placeholder="example@company.com"
                                />
                                <FormInput
                                    label="비밀번호"
                                    name="password"
                                    type="password"
                                    icon={Lock}
                                    value={formData.password}
                                    onChange={handleChange}
                                    required
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        {/* Section 2: Company Info */}
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold text-teal-300 uppercase tracking-wider border-b border-white/10 pb-2">기업 정보</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormInput
                                    label="회사명"
                                    name="companyName"
                                    icon={Building2}
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    required
                                    placeholder="(주)알트에프"
                                />
                                <FormInput
                                    label="사업자등록번호"
                                    name="bizNo"
                                    icon={FileText}
                                    value={formData.bizNo}
                                    onChange={handleChange}
                                    required
                                    placeholder="000-00-00000"
                                />
                                <FormInput
                                    label="담당자명"
                                    name="contactName"
                                    icon={User}
                                    value={formData.contactName}
                                    onChange={handleChange}
                                    required
                                    placeholder="홍길동"
                                />
                                <FormInput
                                    label="연락처"
                                    name="phone"
                                    icon={Phone}
                                    value={formData.phone}
                                    onChange={handleChange}
                                    required
                                    placeholder="010-0000-0000"
                                />
                                <FormInput
                                    label="팩스 (선택)"
                                    name="fax"
                                    icon={Printer}
                                    value={formData.fax}
                                    onChange={handleChange}
                                    placeholder="02-000-0000"
                                />

                                {/* File Upload Mock */}
                                <div className="space-y-2 md:col-span-2">
                                    <label className="text-sm font-bold text-blue-50/90 ml-1">사업자등록증 사본</label>
                                    <div className="flex items-center gap-3">
                                        <label className="flex-1 cursor-pointer group">
                                            <div className={`w-full py-3 px-4 rounded-xl border border-dashed hover:border-teal-400 hover:bg-teal-400/10 transition-all text-sm flex items-center justify-center gap-2 ${fileName ? 'text-teal-300 font-medium border-teal-400/50 bg-teal-400/5' : 'border-white/20 text-blue-100/40'}`}>
                                                <Upload className="w-4 h-4" />
                                                {fileName || "클릭하여 파일 업로드 (JPG, PDF)"}
                                            </div>
                                            <input type="file" className="hidden" onChange={handleFileChange} accept=".jpg,.jpeg,.png,.pdf" />
                                        </label>
                                    </div>

                                    {/* Terms & Conditions */}
                                    <div className="space-y-4 pt-4 border-t border-white/10">
                                        <h3 className="text-sm font-bold text-teal-300 uppercase tracking-wider pb-2">약관 동의</h3>

                                        {/* All Agree */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 mb-4">
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${Object.values(agreements).every(Boolean) ? 'bg-teal-500 border-teal-500 text-white' : 'border-white/30 group-hover:border-teal-400'}`}>
                                                    <Check className="w-3.5 h-3.5" />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="hidden"
                                                    checked={Object.values(agreements).every(Boolean)}
                                                    onChange={(e) => handleAllAgreements(e.target.checked)}
                                                />
                                                <span className="text-white font-bold">전체 약관에 동의합니다</span>
                                            </label>
                                        </div>

                                        <div className="space-y-3 pl-2">
                                            <AgreementItem
                                                label="서비스 이용약관 동의 (필수)"
                                                checked={agreements.terms}
                                                onChange={() => handleAgreementChange('terms')}
                                                link="/policy/terms"
                                            />
                                            <AgreementItem
                                                label="개인정보 수집 및 이용 동의 (필수)"
                                                checked={agreements.privacy}
                                                onChange={() => handleAgreementChange('privacy')}
                                                link="/policy/privacy"
                                            />
                                            <AgreementItem
                                                label="마케팅 정보 수신 동의 (선택)"
                                                checked={agreements.marketing}
                                                onChange={() => handleAgreementChange('marketing')}
                                                link="/policy/marketing"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-blue-100/40 ml-1">* 승인이 완료되면 서비스를 이용하실 수 있습니다.</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-blue-50/90 ml-1">주소</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1 group">
                                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-200/50 w-5 h-5 transition-colors group-focus-within:text-teal-400" />
                                        <input
                                            className="w-full pl-12 pr-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-white/30 focus:bg-black/30 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 outline-none transition-all"
                                            name="address"
                                            value={formData.address}
                                            onChange={handleChange}
                                            required
                                            placeholder="주소 검색을 이용해주세요"
                                            readOnly
                                            onClick={() => setIsAddressModalOpen(true)}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        onClick={() => setIsAddressModalOpen(true)}
                                        className="bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-900/20 rounded-xl px-4 whitespace-nowrap"
                                    >
                                        주소 검색
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="pt-6">
                            <Button type="submit" className="w-full py-4 text-base font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-900/20 border-none transition-all hover:scale-[1.02] active:scale-[0.98]">
                                가입하기
                            </Button>
                        </div>
                    </form>

                    <div className="text-center pt-2 border-t border-white/10 pt-6">
                        <p className="text-blue-50/50 text-sm">
                            이미 계정이 있으신가요?{' '}
                            <Link to="/login" className="text-teal-300 hover:text-white font-bold hover:underline inline-flex items-center gap-1 transition-colors">
                                로그인하기 <ArrowRight className="w-4 h-4" />
                            </Link>
                        </p>
                    </div>
                </div>
            </div>

            <AddressSearchModal
                isOpen={isAddressModalOpen}
                onClose={() => setIsAddressModalOpen(false)}
                onComplete={(data) => setFormData(prev => ({ ...prev, address: data.fullAddress }))}
            />

            <AlertDialog
                isOpen={alertState.isOpen}
                title={alertState.title}
                description={alertState.description}
                type={alertState.type}
                onClose={closeAlert}
            />
        </div >
    );
}

function AgreementItem({ label, checked, onChange, link }: { label: string, checked: boolean, onChange: () => void, link: string }) {
    return (
        <div className="flex items-center justify-between group">
            <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${checked ? 'bg-teal-500 border-teal-500 text-white' : 'border-white/30 group-hover:border-teal-400'}`}>
                    {checked && <Check className="w-3.5 h-3.5" />}
                </div>
                <input type="checkbox" className="hidden" checked={checked} onChange={onChange} />
                <span className="text-blue-50/80 text-sm group-hover:text-white transition-colors">{label}</span>
            </label>
            <Link to={link || "#"} target="_blank" className="text-xs text-white/30 hover:text-teal-300 underline underline-offset-2 transition-colors">
                내용보기
            </Link>
        </div>
    );
}

// Helper Component for consistency
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    icon?: React.ElementType;
}

function FormInput({ label, icon: Icon, className, ...props }: FormInputProps) {
    return (
        <div className={`space-y-2 ${className}`}>
            <label className="text-sm font-bold text-blue-50/90 ml-1">{label}</label>
            <div className="relative group">
                {Icon && <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-200/50 w-5 h-5 transition-colors group-focus-within:text-teal-400" />}
                <input
                    className={`w-full pl-12 pr-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-white/30 focus:bg-black/30 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 outline-none transition-all ${!Icon ? 'pl-4' : ''}`}
                    {...props}
                />
            </div>
        </div>
    );
}
