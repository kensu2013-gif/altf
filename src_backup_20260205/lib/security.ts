/**
 * Security Utilities
 * 
 * Provides functions for:
 * 1. File Signature Verification (Magic Numbers) to prevent malicious file uploads.
 * 2. Input Sanitization to prevent XSS.
 */

/**
 * Validates a file's signature (Magic Numbers) against allowed types.
 * @param file The file to validate
 * @param allowedTypes Array of allowed MIME types (e.g., ['image/jpeg', 'image/png', 'application/pdf'])
 * @returns Promise<boolean> True if signature matches allowed types
 */
export async function validateFileSignature(file: File, allowedTypes: string[]): Promise<boolean> {
    const arr = (await file.slice(0, 4).arrayBuffer());
    const header = new Uint8Array(arr);
    let headerHex = "";
    for (let i = 0; i < header.length; i++) {
        headerHex += header[i].toString(16).toUpperCase();
    }

    // Common Signatures
    // JPEG: FF D8 FF
    // PNG: 89 50 4E 47
    // PDF: 25 50 44 46

    const type = file.type;
    let isValidSignature = false;

    if (type === 'image/jpeg' || type === 'image/jpg') {
        isValidSignature = headerHex.startsWith('FFD8FF');
    } else if (type === 'image/png') {
        isValidSignature = headerHex.startsWith('89504E47');
    } else if (type === 'application/pdf') {
        isValidSignature = headerHex.startsWith('25504446');
    }

    // Check if the mime type is in the allowed list AND signature is valid
    return isValidSignature && allowedTypes.includes(type);
}

/**
 * Sanitizes input string to remove potentially dangerous characters and script tags.
 * Basic XSS prevention for text inputs.
 * @param input Raw input string
 * @returns Sanitized string
 */
export function sanitizeInput(input: string): string {
    if (!input) return '';
    // Remove script tags and event handlers (basic regex)
    return input
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
        .replace(/<[^>]+>/g, "") // Remove all HTML tags
        .replace(/javascript:/gi, "") // Remove void:javascript
        .replace(/on\w+=/gi, ""); // Remove event handlers like onclick=
}

/**
 * Validates strictly if string contains only allowed characters for specific fields
 * @param type 'bizNo' | 'phone' | 'email'
 */
export function validateFormat(value: string, type: 'bizNo' | 'phone' | 'email' | 'text'): boolean {
    if (type === 'bizNo') return /^\d{3}-\d{2}-\d{5}$/.test(value);
    if (type === 'phone') return /^01[0-9]-\d{3,4}-\d{4}$/.test(value); // Mobile only for now or extend
    if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    return true;
}
