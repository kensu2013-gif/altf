import { createContext, useContext } from 'react';

export interface InventoryItem {
    id: string;
    name: string;
    thickness: string;
    spec: string;
    material: string;
    maker: string;
    location: string;
    price: number;
    qty: number;
}

export interface CartItem extends InventoryItem {
    cartQty: number;
}

export interface AuthState {
    isAuthenticated: boolean;
    login: (code: string) => boolean;
    logout: () => void;
}

export interface CartState {
    items: CartItem[];
    addToCart: (item: InventoryItem, qty: number) => void;
    removeFromCart: (id: string) => void;
    clearCart: () => void;
}

// React Context definitions (actual implementation will be in App providers)
export const AuthContext = createContext<AuthState | null>(null);
export const CartContext = createContext<CartState | null>(null);

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}

export function useCart() {
    const context = useContext(CartContext);
    if (!context) throw new Error("useCart must be used within CartProvider");
    return context;
}
export const INVITE_CODES = [
    'ALTF2024',
    'TEST1234',
];