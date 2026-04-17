import { StrictMode } from 'react'
import { useStore } from './store/useStore'

// Global Fetch Interceptor for Security (JWT Injection)
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    const resource = args[0];
    let config = args[1];
    
    const urlStr = typeof resource === 'string' ? resource : (resource instanceof URL ? resource.toString() : (resource as Request).url);
    const isLocalApi = urlStr.includes('/api/') && !urlStr.includes('make.com');
    
    if (isLocalApi) {
        config = config || {};
        const newHeaders: Record<string, string> = {};
        
        // Preserve existing headers if any
        if (config.headers) {
            if (config.headers instanceof Headers) {
                config.headers.forEach((val, key) => newHeaders[key] = val);
            } else if (Array.isArray(config.headers)) {
                config.headers.forEach(([key, val]) => newHeaders[key] = val);
            } else {
                Object.assign(newHeaders, config.headers);
            }
        }
        
        // Inject Auth Headers
        const { auth } = useStore.getState();
        if (auth?.token) {
            newHeaders['Authorization'] = `Bearer ${auth.token}`;
        }
        if (auth?.user) {
            newHeaders['x-requester-id'] = auth.user.id;
            newHeaders['x-requester-role'] = auth.user.role;
        }
        
        config.headers = newHeaders;
        args[1] = config;
    }
    
    return originalFetch(...args);
};

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
