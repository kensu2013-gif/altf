import React from 'react';
import { decryptField } from '../../utils/security';

interface SecureTextProps {
    value: string | number | undefined | null;
    className?: string;
    as?: 'span' | 'div' | 'p';
}

/**
 * Just-In-Time Decryption Component.
 * Decrypts the value only during render and displays it.
 * Does not store the result in any global state.
 */
export const SecureText: React.FC<SecureTextProps> = ({ value, className, as: Component = 'span' }) => {
    // Decrypt on every render (JIT)
    // Optimization: validation of cost - for small strings AES is fast enough.
    // If list is large (virtualized), this is acceptable.

    // We treat 'value' as potentially encrypted.
    const displayValue = decryptField(value);

    return (
        <Component className={className}>
            {displayValue}
        </Component>
    );
};
