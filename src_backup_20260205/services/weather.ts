export type WeatherIconType = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'mist';

export interface WeatherData {
    tempC: number;
    city: string;
    icon: WeatherIconType;
    updatedAt: string;
    expiresAt: number; // timestamp
}

const CACHE_KEY = 'last_weather_cache';
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export const WeatherService = {
    async getWeather(): Promise<WeatherData> {
        // 1. Check Cache
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const parsed: WeatherData = JSON.parse(cached);
                if (Date.now() < parsed.expiresAt) {
                    console.log('Using cached weather data');
                    return parsed;
                }
            } catch (e) {
                console.error('Cache parse error', e);
            }
        }

        // 2. Fetch Fresh Data
        try {
            let loc;
            try {
                loc = await this.getLocation(); // Priority: Geo -> IP
            } catch (e) {
                console.warn('Location detection failed, falling back to Busan', e);
                loc = { lat: 35.1796, lon: 129.0756, city: 'Busan' };
            }

            const weather = await this.fetchWeather(loc.lat, loc.lon);

            // Save to Cache
            const data: WeatherData = {
                ...weather,
                city: loc.city || weather.city, // Prefer detected city name if api didn't return one
                expiresAt: Date.now() + CACHE_DURATION_MS
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));

            return data;
        } catch (error) {
            console.error('Weather fetch failed, falling back to cache if available', error);
            // Fallback: Return expired cache if exists? Or default?
            // User requirement: "If failed + cache exists -> show cache"
            if (cached) {
                return JSON.parse(cached);
            }
            // Final Fallback: Busan (Mock) - Only if EVERYTHING fails (Loc + API)
            console.log('Using default mock fallback (Busan)');
            return {
                tempC: 15,
                city: 'Busan',
                icon: 'sun',
                updatedAt: new Date().toISOString(),
                expiresAt: Date.now() + CACHE_DURATION_MS
            };
        }
    },

    async getLocation(): Promise<{ lat: number; lon: number; city?: string }> {
        // 1. Browser Geolocation
        try {
            return await new Promise((resolve, reject) => {
                if (!navigator.geolocation) return reject('No Geo API');

                const timeoutId = setTimeout(() => reject('Geo timeout'), 3000);

                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        clearTimeout(timeoutId);
                        resolve({
                            lat: pos.coords.latitude,
                            lon: pos.coords.longitude
                        });
                    },
                    (err) => {
                        clearTimeout(timeoutId);
                        reject(err);
                    },
                    { timeout: 3000 }
                );
            });
        } catch (e) {
            console.log('Browser Geo failed:', e);
        }

        // 2. IP Geolocation (via backend)
        try {
            console.log('Trying IP Geolocation...');
            const res = await fetch('/api/geo/ip');
            if (res.ok) {
                const data = await res.json();
                if (data.lat && data.lon) {
                    return { lat: data.lat, lon: data.lon, city: data.city };
                }
            }
        } catch (e) {
            console.log('IP Geo failed:', e);
        }

        throw new Error('All location services failed');
    },

    async fetchWeather(lat: number, lon: number): Promise<Omit<WeatherData, 'expiresAt'>> {
        // Timeout 5s
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error('Weather API bad status');

            return await res.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};
