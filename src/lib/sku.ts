
export const generateSku = (item: { name: string; thickness?: string; size?: string; material?: string }): string => {
    const parts = [
        item.name,
        item.thickness,
        item.size,
        item.material
    ].filter(p => p && p.trim() !== '' && p !== '-');

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
