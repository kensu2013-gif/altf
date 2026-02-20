import type { ReactNode } from 'react';

import { Header } from './Header';
import { Footer } from './Footer';
// import { GlobalUploadManager } from '../GlobalUploadManager';
// import { GlobalUploadIndicator } from '../ui/GlobalUploadIndicator';

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {


    return (
        <div className="flex flex-col min-h-screen bg-slate-50 font-sans text-slate-900">
            <Header />
            <main className="flex-1 w-full max-w-[1920px] mx-auto min-w-[320px]">
                {children}
            </main>
            {/* <GlobalUploadManager /> */} {/* Logic: Background Poller */}
            {/* <GlobalUploadIndicator /> */} {/* UI: PiP status */}
            <Footer />
        </div>
    );
}
