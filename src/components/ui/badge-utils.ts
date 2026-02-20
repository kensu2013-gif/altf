export type BadgeColor = 'default' | 'mint' | 'blue' | 'purple' | 'orange' | 'teal' | 'amber' | 'slate' | 'red' | 'yellow';

export function getLocationBadgeColor(location: string): BadgeColor {
    switch (location) {
        case '부산': return 'mint';
        case '양산': return 'purple';
        case '울산': return 'blue';
        case '시흥': return 'orange';
        default: return 'default';
    }
}
