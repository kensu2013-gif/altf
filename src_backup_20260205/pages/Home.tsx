import { Button } from "@/components/ui/Button";
import { Link } from "react-router-dom";

export default function Home() {
    return (
        <div className="relative min-h-screen overflow-x-hidden font-pretendard">
            {/* Background Image - Fixed */}
            <div
                className="fixed inset-0 z-0 bg-search bg-cover bg-center bg-no-repeat"
            >
                {/* Lighter overlay to show photo but keep text readable */}
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px]" />
            </div>

            {/* Content Container */}
            <div className="relative z-10 flex flex-col min-h-screen">

                {/* Hero Section */}
                <main className="flex-1 flex flex-col items-center justify-center text-center px-4 pt-32 pb-20">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6 drop-shadow-sm leading-tight tracking-tight">
                        찾고 있는 PIPE FITTING 자재는<br />
                        무엇인가요?
                    </h1>
                    <p className="text-base md:text-lg text-slate-700 mb-12 max-w-2xl drop-shadow-sm font-medium leading-relaxed">
                        알트에프는 구매결정에 소요되는<br className="md:hidden" />
                        당신의 시간을 최대한 절약 시켜 드리겠습니다.
                    </p>
                </main>

                {/* Cards Section */}
                <section className="w-full py-16 md:py-24">
                    <div className="container mx-auto px-4">
                        <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">

                            {/* QUICK Card */}
                            <div className="bg-white p-12 md:p-16 rounded-[32px] flex flex-col justify-between text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 min-h-[420px]">
                                <div>
                                    <div className="mb-8 flex justify-center">
                                        <span className="bg-teal-50 text-teal-600 px-4 py-1.5 rounded-full text-sm font-bold tracking-widest flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                            QUICK
                                        </span>
                                    </div>
                                    <h3 className="text-slate-900 font-bold text-2xl md:text-3xl mb-4 leading-relaxed whitespace-pre-line">
                                        필요하신 재고와 단가를{"\n"}
                                        즉시 확인해 보세요
                                    </h3>
                                </div>
                                <div className="mt-10">
                                    <Link to="/search">
                                        <Button className="bg-[#009490] hover:bg-[#007f7b] text-white px-12 py-6 text-lg font-bold rounded-xl w-full shadow-lg border-none transition-all hover:scale-105 active:scale-95">
                                            검색하기
                                        </Button>
                                    </Link>
                                </div>
                            </div>

                            {/* EASY Card */}
                            <div className="bg-white p-12 md:p-16 rounded-[32px] flex flex-col justify-between text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 min-h-[420px]">
                                <div>
                                    <div className="mb-8 flex justify-center">
                                        <span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-sm font-bold tracking-widest flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                            EASY
                                        </span>
                                    </div>
                                    <h3 className="text-slate-900 font-bold text-2xl md:text-3xl mb-4 leading-relaxed whitespace-pre-line">
                                        담당자에게 필요한 자재를{"\n"}
                                        직접문의해 보세요.
                                    </h3>
                                </div>
                                <div className="mt-10">
                                    <a href="http://pf.kakao.com/_jxcxaBn" target="_blank" rel="noopener noreferrer" className="block w-full">
                                        <Button className="bg-[#FFD700] hover:bg-[#F0C800] text-slate-900 px-12 py-6 text-lg font-bold rounded-xl w-full shadow-lg border-none transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
                                            <span className="text-xl">💬</span>
                                            문의하기
                                        </Button>
                                    </a>
                                </div>
                            </div>

                        </div>
                    </div>
                </section>

            </div>
        </div>
    );
}
