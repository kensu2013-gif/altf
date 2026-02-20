export default function AdminSettings() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">설정</h1>
                <p className="text-slate-500 text-sm mt-1">시스템 기본 설정을 확인합니다.</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100">
                <div className="p-6 space-y-4">
                    <h3 className="font-bold text-slate-900">관리자 정보</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingItem label="수신 이메일" value="altf@altf.kr" readonly />
                        <SettingItem label="알림 설정" value="이메일, 카카오톡" readonly />
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <h3 className="font-bold text-slate-900">브랜드 설정</h3>
                    <div className="flex items-center gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Primary Color</label>
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-teal-600 shadow-lg shadow-teal-500/20 ring-2 ring-offset-2 ring-teal-600"></div>
                                <div>
                                    <p className="font-mono text-sm font-bold text-slate-700">Teal 600</p>
                                    <p className="text-xs text-slate-400">#0d9488</p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Secondary Color</label>
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-slate-900 shadow-lg shadow-slate-900/20 ring-2 ring-offset-2 ring-slate-900"></div>
                                <div>
                                    <p className="font-mono text-sm font-bold text-slate-700">Slate 900</p>
                                    <p className="text-xs text-slate-400">#0f172a</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingItem({ label, value, readonly = false }: { label: string, value: string, readonly?: boolean }) {
    return (
        <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">{label}</label>
            <input
                type="text"
                value={value}
                readOnly={readonly}
                title={label}
                className={`w-full px-4 py-2 rounded-lg border border-slate-200 text-sm ${readonly ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-900'}`}
            />
        </div>
    )
}
