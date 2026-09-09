import { Folder, File, FileText, FileImage, FileVideoCamera, FileMusic, FileArchive, FileCode, FileSpreadsheet, Presentation } from '@lucide/svelte';

const EXT_ICON: Record<string, typeof File> = {
	md: FileText, markdown: FileText, txt: FileText, rtf: FileText, doc: FileText, docx: FileText, odt: FileText, pdf: FileText,
	ppt: Presentation, pptx: Presentation, odp: Presentation,
	js: FileCode, mjs: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode, json: FileCode, html: FileCode, css: FileCode, py: FileCode, sh: FileCode, yml: FileCode, yaml: FileCode,
	png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage, avif: FileImage, bmp: FileImage, ico: FileImage,
	mp4: FileVideoCamera, m4v: FileVideoCamera, mov: FileVideoCamera, mkv: FileVideoCamera, webm: FileVideoCamera, avi: FileVideoCamera, mpeg: FileVideoCamera, mpg: FileVideoCamera, ogv: FileVideoCamera, '3gp': FileVideoCamera, wmv: FileVideoCamera, flv: FileVideoCamera, vob: FileVideoCamera, mts: FileVideoCamera, m2ts: FileVideoCamera,
	mp3: FileMusic, wav: FileMusic, ogg: FileMusic, oga: FileMusic, flac: FileMusic, m4a: FileMusic, aac: FileMusic, opus: FileMusic, wma: FileMusic, aif: FileMusic, aiff: FileMusic, amr: FileMusic, mid: FileMusic, midi: FileMusic,
	zip: FileArchive, rar: FileArchive, tar: FileArchive, gz: FileArchive, '7z': FileArchive,
	xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet
};

export function iconFor(name: string, type: 'dir' | 'file') {
	if (type === 'dir') return Folder;
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	return EXT_ICON[ext] ?? File;
}
