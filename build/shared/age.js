/**
 * Compact age badge, byte-for-byte compatible with the host's own sidebar
 * formatter (`src/components/sidebar/utils/utils.ts`): `<1m`, `Nm`, `Nhr`, `Nd`.
 */
export const formatCompactAge = (iso, now) => {
    if (!iso)
        return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '';
    const minutes = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 60000);
    if (minutes < 1)
        return '<1m';
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}hr` : `${Math.floor(hours / 24)}d`;
};
