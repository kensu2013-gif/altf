


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
    if (!sku) {
        return { name: '', thickness: '', size: '', material: '' };
    }
    const parts = sku.split('-');
    if (parts.length < 3) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: '',
            material: ''
        };
    }

    const primaryPrefixes = ['STS', 'WP'];
    const otherPrefixes = [
        'ALLOY', 'C276', 'C706', 'C715', 'N022', 'N044', 'PG37', 
        'S318', 'S322', 'S327', 'SPP', 'STSB', 'WPB', 'WPHC'
    ];

    let materialIndex = -1;
    // Search for a part starting with STS or WP first (primary)
    for (let i = 2; i < parts.length; i++) {
        const partUpper = parts[i].toUpperCase();
        if (primaryPrefixes.some(prefix => partUpper.startsWith(prefix))) {
            materialIndex = i;
            break;
        }
    }

    // If not found, check the other prefixes
    if (materialIndex === -1) {
        for (let i = 2; i < parts.length; i++) {
            const partUpper = parts[i].toUpperCase();
            if (otherPrefixes.some(prefix => partUpper.startsWith(prefix))) {
                materialIndex = i;
                break;
            }
        }
    }

    if (materialIndex !== -1) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: parts.slice(2, materialIndex).join('-'),
            material: parts.slice(materialIndex).join('-')
        };
    }

    // Fallback if no prefix is matched
    if (parts.length >= 4) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: parts.slice(2, parts.length - 1).join('-'),
            material: parts[parts.length - 1] || ''
        };
    }

    return {
        name: parts[0] || '',
        thickness: parts[1] || '',
        size: parts[2] || '',
        material: ''
    };
};

