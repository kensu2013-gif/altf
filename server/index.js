import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const app = express();
const PORT = 8787;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper: Atomic Write
const writeData = (filename, data) => {
    const filePath = path.join(DATA_DIR, filename);
    const tempPath = `${filePath}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        console.error(`Failed to write ${filename}:`, error);
        throw error;
    }
};

// Helper: Read Data
const readData = (filename, defaultValue = []) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return defaultValue;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Failed to read ${filename}:`, error);
        return defaultValue;
    }
};

app.use(cors());
app.use(express.json());

// API Keys
const IP_GEO_API_KEY = process.env.IP_GEO_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

// --- PERSISTENCE ENDPOINTS ---

// GET /api/my/profile (Mock)
app.get('/api/my/profile', (req, res) => {
    // In a real app, we'd get userId from session/token
    // Here we just return a mock or expect a query param ?userId=...
    const userId = req.query.userId;
    if (!userId) return res.json({ name: 'Guest', email: 'guest@example.com' });

    // We could look up in users.json if we had it
    res.json({ id: userId, name: 'Demo User', email: 'user@altf.com' });
});

// GET /api/my/quotations
app.get('/api/my/quotations', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const quotations = readData('quotations.json');
    const userQuotes = quotations.filter(q => q.userId === userId);
    res.json(userQuotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// POST /api/my/quotations
app.post('/api/my/quotations', (req, res) => {
    const { userId, items, totalAmount, customerName } = req.body;
    if (!userId || !items) return res.status(400).json({ error: 'Missing data' });

    const quotations = readData('quotations.json');
    const newQuote = {
        id: crypto.randomUUID(),
        userId,
        items,
        totalAmount,
        customerName,
        createdAt: new Date().toISOString()
    };

    quotations.push(newQuote);
    writeData('quotations.json', quotations);

    res.json(newQuote);
});

// GET /api/my/orders
app.get('/api/my/orders', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const orders = readData('orders.json');
    const userOrders = orders.filter(o => o.userId === userId);
    res.json(userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// POST /api/my/orders
app.post('/api/my/orders', (req, res) => {
    const { userId, items, totalAmount, customerName } = req.body;
    if (!userId || !items) return res.status(400).json({ error: 'Missing data' });

    const orders = readData('orders.json');
    const newOrder = {
        id: crypto.randomUUID(),
        userId,
        items,
        totalAmount,
        customerName,
        status: 'submitted', // submitted, processing, shipped, completed
        createdAt: new Date().toISOString()
    };

    orders.push(newOrder);
    writeData('orders.json', orders);

    res.json(newOrder);
});

// GET /api/admin/orders
app.get('/api/admin/orders', (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    // Simple check (in real app, verify JWT role)
    // For this demo, we accept if client claims to be admin or if we're in dev mode
    // Let's assume frontend sends a specific header or we just return all for demo if requested.

    const orders = readData('orders.json');
    res.json(orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// PATCH /api/admin/orders/:id
app.patch('/api/admin/orders/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const orders = readData('orders.json');
    const orderIndex = orders.findIndex(o => o.id === id);

    if (orderIndex === -1) return res.status(404).json({ error: 'Order not found' });

    orders[orderIndex].status = status;
    writeData('orders.json', orders);

    res.json(orders[orderIndex]);
});

// 1) GET /api/geo/ip - Get location from IP
app.get('/api/geo/ip', async (req, res) => {
    try {
        // Using ipapi.co (Json) - No key needed for limited usage, or use key if provided
        // Or ipinfo.io if key provided.
        // For this demo, let's use ipapi.co/json as it's free and simple without key (rate limited)
        // or a mock if it fails.

        // Note: In real prod, use the key from env. 
        // Example: https://ipinfo.io/json?token=${IP_GEO_API_KEY}

        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) throw new Error('Geo API failed');

        const data = await response.json();

        // Standardize output
        res.json({
            city: data.city || 'Unknown',
            lat: data.latitude,
            lon: data.longitude
        });
    } catch (error) {
        console.error('Geo API error:', error);
        res.status(500).json({ error: 'Failed to get location' });
    }
});

// 2) GET /api/weather - Get weather from Open-Meteo (Free, no key needed) 
// or OpenWeather (Needs key)
// User asked to use OpenWeather or Tomorrow.io.
// To make it run successfully without forcing user to have a key immediately, 
// I will attempt OpenWeather if key exists, otherwise Open-Meteo (fallback) or mock.
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;

    if (!lat || !lon) {
        return res.status(400).json({ error: 'Missing lat/lon' });
    }

    try {
        let weatherData = null;

        // Priority 1: OpenWeather (if key exists)
        if (WEATHER_API_KEY) {
            const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                // Map to our format
                weatherData = {
                    city: data.name,
                    tempC: data.main.temp,
                    icon: mapOpenWeatherIcon(data.weather[0].icon),
                    description: data.weather[0].main,
                    updatedAt: new Date().toISOString()
                };
            }
        }

        // Priority 2: Open-Meteo (Free, No Key) - Fallback
        if (!weatherData) {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                weatherData = {
                    city: 'Unknown', // Open-Meteo doesn't return city name
                    tempC: data.current_weather.temperature,
                    icon: mapWmoCode(data.current_weather.weathercode),
                    description: 'Weather',
                    updatedAt: new Date().toISOString()
                };
            }
        }

        if (weatherData) {
            res.json(weatherData);
        } else {
            throw new Error('All weather providers failed');
        }

    } catch (error) {
        console.error('Weather API error:', error);
        res.status(500).json({ error: 'Failed to fetch weather' });
    }
});

// Helper: Map OpenWeather icon code to our simple enum
// "sun" | "cloud" | "rain" | "snow" | "storm" | "mist"
function mapOpenWeatherIcon(code) {
    if (code.startsWith('01')) return 'sun'; // clear
    if (code.startsWith('02')) return 'cloud'; // few clouds
    if (code.startsWith('03') || code.startsWith('04')) return 'cloud'; // scattered/broken clouds
    if (code.startsWith('09') || code.startsWith('10')) return 'rain'; // shower/rain
    if (code.startsWith('11')) return 'storm'; // thunderstorm
    if (code.startsWith('13')) return 'snow'; // snow
    if (code.startsWith('50')) return 'mist'; // mist
    return 'sun';
}

// Helper: Map WMO code (Open-Meteo) to our simple enum
function mapWmoCode(code) {
    if (code === 0 || code === 1) return 'sun';
    if (code === 2 || code === 3) return 'cloud';
    if (code >= 51 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 95) return 'storm';
    if (code >= 45 && code <= 48) return 'mist';
    return 'cloud';
}

app.listen(PORT, () => {
    console.log(`Weather Server running on http://localhost:${PORT}`);
});
