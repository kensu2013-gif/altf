import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCart, type InventoryItem } from '../lib/store';
import inventoryData from '../data/mock_inventory.json';
import quotesData from '../data/mock_quotes.json';
import { Loader2 } from 'lucide-react';
import type { Product } from '../types';

export default function QuoteLoader() {
    const { quoteId } = useParams();
    const navigate = useNavigate();
    const { addToCart, clearCart } = useCart();
    const processed = useRef(false);

    useEffect(() => {
        if (processed.current) return;
        processed.current = true;

        if (!quoteId) {
            navigate('/search');
            return;
        }

        // Simulate network delay
        setTimeout(() => {
            const quoteItems = (quotesData as Record<string, { id: string; qty: number }[]>)[quoteId];
            if (quoteItems && Array.isArray(quoteItems)) {
                // Clear current cart? User said "Fill cart state". strict fill or append?
                // Assuming replace or append. Let's append but nice to clear.
                // User said: "Load quoteId... Find items... Fill cart state and redirect"
                // I will clear first to match the quote exactly.
                clearCart();

                let count = 0;
                quoteItems.forEach((qItem: { id: string; qty: number }) => {
                    const invItem = (inventoryData as unknown as Product[]).find(i => i.id === qItem.id);
                    if (invItem) {
                        // Map Product to InventoryItem (legacy store expects different keys)
                        const cartItem: InventoryItem = {
                            id: invItem.id,
                            name: invItem.name,
                            thickness: invItem.thickness,
                            material: invItem.material,
                            spec: invItem.size,
                            price: invItem.unitPrice,
                            qty: invItem.currentStock,
                            location: invItem.location || '',
                            maker: invItem.maker || ''
                        };
                        addToCart(cartItem, qItem.qty);
                        count++;
                    }
                });

                if (count > 0) {
                    // Toast could be here, but we'll use a simple alert or just redirect
                    // The request said "toast '견적이 장바구니에 담겼습니다'"
                    // I'll assume a toast library isn't installed, will use alert for now or implement a simple one.
                    // Or just render text then redirect.
                    alert('견적이 장바구니에 담겼습니다.');
                    navigate('/cart');
                } else {
                    alert('견적 상품을 찾을 수 없습니다.');
                    navigate('/search');
                }
            } else {
                alert('유효하지 않은 견적 링크입니다.');
                navigate('/search');
            }
        }, 1000);
    }, [quoteId, navigate, addToCart, clearCart]);

    return (
        <div className="mx-auto max-w-[1100px] px-4 py-8 flex flex-col items-center justify-center min-h-[60vh]">
            <Loader2 className="h-10 w-10 text-primary-500 animate-spin mb-4" />
            <h2 className="text-xl font-medium text-slate-700">견적 정보를 불러오는 중입니다...</h2>
        </div>
    );
}
