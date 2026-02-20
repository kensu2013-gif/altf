import { useState, useEffect } from 'react';


interface LoginWidgetsProps {
    showClock?: boolean;
}

export function LoginWidgets({ showClock = true }: LoginWidgetsProps) {

    const [time, setTime] = useState(new Date());

    // Clock
    useEffect(() => {
        if (!showClock) return;
        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, [showClock]);

    // Format for Local Time
    const formatter = new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const parts = formatter.formatToParts(time);
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || '';
    const timeNum = `${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}:${parts.find(p => p.type === 'second')?.value}`;

    const dateString = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} (${new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(time)})`;

    // Time Status Logic
    const getTimeStatus = (date: Date) => {
        const h = date.getHours();
        const m = date.getMinutes();

        // Lunch: 12:00:00 - 12:59:59
        if (h === 12) return 'LUNCH';

        // Off-Work: 18:30:00 - 08:29:59
        // Dinner/Night: 18:30 ~ 23:59
        if (h > 18 || (h === 18 && m >= 30)) return 'OFF_WORK';
        // Morning: 00:00 ~ 08:29
        if (h < 8 || (h === 8 && m < 30)) return 'OFF_WORK';

        return 'NORMAL';
    };

    const status = getTimeStatus(time);

    const getStyles = (s: string) => {
        switch (s) {
            case 'LUNCH':
                return {
                    dateClass: 'text-rose-200/90',
                    timeClass: 'text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.3)]',
                    message: '- 지금은 점심시간입니다. 응답이 늦을수도 있습니다. -',
                    messageClass: 'text-rose-300/80'
                };
            case 'OFF_WORK':
                return {
                    dateClass: 'text-emerald-200/90',
                    timeClass: 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]',
                    message: '지금은 업무 종료시간입니다. 담당자 응답이 늦을수있습니다',
                    messageClass: 'text-emerald-300/80'
                };
            default:
                return {
                    dateClass: 'text-white',
                    timeClass: 'text-blue-100/90',
                    message: '',
                    messageClass: ''
                };
        }
    };

    if (!showClock) return null;

    const styles = getStyles(status);

    return (
        <div className="w-full p-6 md:p-8 flex flex-col justify-center items-center z-20 pointer-events-none text-white/90 shrink-0 relative">
            <div className="flex flex-col items-center mx-auto animate-in fade-in slide-in-from-top-4 duration-1000 font-gowun">
                <div className={`text-3xl sm:text-4xl md:text-5xl font-bold tracking-wide drop-shadow-md transition-colors duration-500 ${styles.dateClass}`}>
                    {dateString}
                </div>
                <div className={`flex items-baseline justify-center mt-2 tracking-widest transition-colors duration-500 ${styles.timeClass}`}>
                    <span className="font-sans text-lg sm:text-xl md:text-2xl mr-2 md:mr-3 font-normal opacity-90">{dayPeriod}</span>
                    <span className="text-2xl sm:text-3xl md:text-4xl font-medium">{timeNum}</span>
                </div>
                {styles.message && (
                    <div className={`text-xs sm:text-sm md:text-base font-medium mt-2 md:mt-3 tracking-wider animate-pulse transition-colors duration-500 ${styles.messageClass}`}>
                        {styles.message}
                    </div>
                )}
            </div>
        </div>
    );
}
