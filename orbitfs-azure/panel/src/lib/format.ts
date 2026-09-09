export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** i;
	return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
	const date = new Date(iso);
	const now = new Date();
	if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
