import { useState, useEffect, memo } from 'react';
import { Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudFog, Loader2, MapPin, RefreshCcw } from 'lucide-react';
import type { WeatherData } from '../services/weather';
import { WeatherService } from '../services/weather';

export const WeatherWidget = memo(function WeatherWidget() {
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            let hasData = false;
            try {
                // Check if we have valid cache to show immediately
                const cached = localStorage.getItem('last_weather_cache');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    // Show immediately if exists (even if expired, we'll update in bg)
                    setWeather(parsed);
                    setLoading(false);
                    hasData = true;
                }

                // Fetch fresh
                const data = await WeatherService.getWeather();

                if (mounted) {
                    setWeather(data);
                    setLoading(false);
                    setError(false);
                }
            } catch (e) {
                console.error(e);
                if (mounted) {
                    setLoading(false);
                    // If no weather data at all (no cache, fetch failed)
                    if (!hasData) setError(true);
                }
            }
        };

        load();

        return () => { mounted = false; };
    }, []);

    const getIcon = (iconCode: string) => {
        const className = "w-8 h-8";
        switch (iconCode) {
            case 'sun': return <Sun className={`${className} text-amber-400`} />;
            case 'cloud': return <Cloud className={`${className} text-blue-100`} />;
            case 'rain': return <CloudRain className={`${className} text-blue-300`} />;
            case 'snow': return <CloudSnow className={`${className} text-white`} />;
            case 'storm': return <CloudLightning className={`${className} text-purple-300`} />;
            case 'mist': return <CloudFog className={`${className} text-slate-300`} />;
            default: return <Cloud className={`${className} text-slate-200`} />;
        }
    };

    if (error && !weather) {
        return (
            <div className="absolute top-8 right-8 flex items-center bg-black/20 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg text-white/50 text-xs gap-2">
                <Cloud className="w-4 h-4" />
                <span>날씨 정보를 불러올 수 없음</span>
            </div>
        );
    }

    // Determine if loading explicitly (show spinner if no data yet)
    if (loading && !weather) {
        return (
            <div className="absolute top-8 right-8 flex items-center bg-black/20 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg">
                <Loader2 className="w-6 h-6 animate-spin text-white/50" />
            </div>
        );
    }

    if (!weather) return null;

    const lastUpdate = new Date(weather.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="absolute top-8 right-8 flex items-center gap-4 bg-black/20 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg animate-in fade-in slide-in-from-top-4 duration-700 group hover:bg-black/30 transition-all">
            <div className="flex flex-col items-end">
                <div className="flex items-center gap-2">
                    <span className="text-3xl font-bold text-white tracking-tighter shadow-black/10 drop-shadow-sm">{Math.round(weather.tempC)}°</span>
                </div>
                <span className="text-xs text-white/70 flex items-center gap-1 font-medium">
                    <MapPin className="w-3 h-3" /> {weather.city}
                </span>
            </div>

            <div className="bg-white/10 p-2.5 rounded-full shadow-inner ring-1 ring-white/10 group-hover:bg-white/20 transition-colors">
                {getIcon(weather.icon)}
            </div>

            {/* Hover Tooltip for Last Update */}
            <div className="absolute -bottom-6 right-0 text-[10px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                <RefreshCcw className="w-2 h-2" /> 업데이트: {lastUpdate}
            </div>
        </div>
    );
});
