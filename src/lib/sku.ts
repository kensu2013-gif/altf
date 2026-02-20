


export const generateSku = (item: { name?: string; thickness?: string; size?: string; material?: string }): string => {
    if (!item) return '';
    const parts = [
        item.name,
        item.thickness,
        item.size,
        item.material
    ].filter(p => p && typeof p === 'string' && p.trim() !== '' && p !== '-');

    return parts.join('-');
};

export const parseSku = (sku: string): { name: string; thickness: string; size: string; material: string } => {
    const parts = sku.split('-');
    return {
        name: parts[0] || '',
        thickness: parts[1] || '',
        size: parts[2] || '',
        material: parts[3] || ''
    };
};
