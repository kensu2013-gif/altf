import CryptoJS from 'crypto-js';

const SECRET_KEY = import.meta.env.VITE_APP_SECRET_KEY || 'antigravity-secret-key-2026';

/**
 * Decrypts a ciphertext string using AES-256.
 * Returns the plaintext string.
 * If input is null/undefined/empty, returns empty string.
 * If decryption fails, returns original string (fallback) or error indicator.
 */
export function decryptField(ciphertext: string | number | undefined | null): string {
    if (ciphertext === null || ciphertext === undefined) return '';
    if (ciphertext === '') return '';

    try {
        const bytes = CryptoJS.AES.decrypt(String(ciphertext), SECRET_KEY);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        // Anti-Gravity: If decryption result is empty but input wasn't, it implies failure/wrong key
        if (!originalText && String(ciphertext).length > 0) {
            // Fallback: In DEV, show original. In PROD, show error placeholder to prevent white screen.
            return import.meta.env.DEV ? `(DEC_FAIL: ${String(ciphertext).substring(0, 5)}...)` : 'Data Loading...';
        }
        return originalText || String(ciphertext);
    } catch {
        if (import.meta.env.DEV) console.warn('Decryption failed for:', ciphertext);
        return 'Data Loading...'; // Safe fallback to prevent UI crash
    }
}

/**
 * Decrypts a JSON string field (e.g. locationStock).
 */
export function decryptJSON<T>(ciphertext: string | undefined | null): T | null {
    if (!ciphertext) return null;
    try {
        const jsonStr = decryptField(ciphertext);
        if (!jsonStr || jsonStr === 'Data Loading...') return null; // Handle fallback
        return JSON.parse(jsonStr) as T;
    } catch (e) {
        console.warn('JSON Parse failed', e);
        return null;
    }
}

/**
 * Encrypts a plaintext string or number using AES-256.
 * Returns the ciphertext string.
 */
export function encryptField(plaintext: string | number | undefined | null): string {
    if (plaintext === null || plaintext === undefined || plaintext === '') return '';
    try {
        const val = String(plaintext);
        const ciphertext = CryptoJS.AES.encrypt(val, SECRET_KEY).toString();
        return ciphertext;
    } catch (e) {
        console.warn('Encryption failed', e);
        return '';
    }
}
