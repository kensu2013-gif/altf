import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export default function QuoteLoader() {
    const { quoteId } = useParams();
    const navigate = useNavigate();
    const processed = useRef(false);

    useEffect(() => {
        if (processed.current) return;
        processed.current = true;

        if (!quoteId) {
            navigate('/search');
            return;
        }

        // Simulate network delay for old quote loading pattern
        setTimeout(() => {
            alert('견적 정보를 불러오는 기능은 현재 준비 중입니다.');
            navigate('/search');
        }, 1000);
    }, [quoteId, navigate]);

    return (
        <div className="mx-auto max-w-[1100px] px-4 py-8 flex flex-col items-center justify-center min-h-[60vh]">
            <Loader2 className="h-10 w-10 text-primary-500 animate-spin mb-4" />
            <h2 className="text-xl font-medium text-slate-700">견적 정보를 불러오는 중입니다...</h2>
        </div>
    );
}
