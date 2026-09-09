import { untrack } from 'svelte';

export class ApiError extends Error {
	status: number;
	code?: string;
	constructor(message: string, status: number, code?: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

type HeaderProvider = () => Record<string, string>;
const headerProviders = new Set<HeaderProvider>();
const API_BASE = '/api';

export function registerHeaderProvider(provider: HeaderProvider) {
	headerProviders.add(provider);
	return () => headerProviders.delete(provider);
}

function apiUrl(path: string) {
	return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function contextHeaders(): HeadersInit {
	return untrack(() => {
		const headers: Record<string, string> = {};
		for (const provider of headerProviders) Object.assign(headers, provider());
		return headers;
	});
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	for (const [key, value] of Object.entries(contextHeaders())) headers.set(key, value);
	if (init.body && !(init.body instanceof ArrayBuffer) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const res = await fetch(apiUrl(path), { ...init, headers, credentials: 'same-origin' });
	const isJson = res.headers.get('content-type')?.includes('application/json');
	const body = isJson ? await res.json().catch(() => ({})) : null;
	if (res.status === 401) {
		if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.assign('/login');
		throw new ApiError(body?.error || 'Session expired', 401, body?.code);
	}
	if (!res.ok) {
		const code = body?.code;
		if ((code === 'LICENSE_REQUIRED' || code === 'LICENSE_COMPONENT_DENIED') && typeof window !== 'undefined' && !window.location.pathname.startsWith('/license') && !window.location.pathname.startsWith('/admin/license')) {
			window.location.assign(`/license?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
		}
		throw new ApiError(body?.error || res.statusText || 'Request failed', res.status, code);
	}
	return body as T;
}

export const api = {
	get: <T>(path: string, headers?: HeadersInit) => request<T>(path, { headers }),
	post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
	patch: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
	put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
	delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
	upload: (path: string, file: File, onProgress?: (pct: number) => void) => new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', apiUrl(path));
		for (const [key, value] of Object.entries(contextHeaders())) xhr.setRequestHeader(key, value);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.upload.onprogress = (event) => { if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100)); };
		xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new ApiError(xhr.responseText || 'Upload failed', xhr.status)); };
		xhr.onerror = () => reject(new ApiError('Upload failed', 0));
		xhr.send(file);
	}),
	uploadChunked: async (path: string, file: File, onProgress?: (pct: number) => void) => {
		if (file.size <= 3 * 1024 * 1024) {
			const directPath = path.replace(/^\/upload-chunked/, '/upload');
			await api.upload(directPath, file, onProgress);
			onProgress?.(100);
			return;
		}
		const init = await request<any>(path, { method:'POST', body:JSON.stringify({ action:'init', size:file.size, mimeType:file.type || 'application/octet-stream' }) });
		await new Promise<void>((resolve,reject) => {
			const xhr=new XMLHttpRequest(); xhr.open('PUT',init.signedUrl); const form=new FormData();
			form.append('cacheControl','3600'); form.append('',file);
			xhr.setRequestHeader('x-upsert','true');
			xhr.upload.onprogress=(e)=>{ if(e.lengthComputable) onProgress?.(Math.min(99,Math.round((e.loaded/e.total)*100))); };
			xhr.onload=()=>{
				if(xhr.status>=200&&xhr.status<300)return resolve();
				let message=xhr.responseText||'Storage upload failed';
				try{const body=JSON.parse(xhr.responseText||'{}');message=body?.message||body?.error||message;}catch{}
				reject(new ApiError(message,xhr.status));
			};
			xhr.onerror=()=>reject(new ApiError('Storage upload request failed',0)); xhr.send(form);
		});
		await request<any>(path,{method:'POST',body:JSON.stringify({action:'finalize',size:file.size,mimeType:file.type||'application/octet-stream',storagePath:init.storagePath})});
		onProgress?.(100);
	},
	uploadResult: <T>(path: string, file: File, headers: Record<string, string> = {}, onProgress?: (pct: number) => void) => new Promise<T>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', apiUrl(path));
		for (const [key, value] of Object.entries(contextHeaders())) xhr.setRequestHeader(key, value);
		for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.upload.onprogress = (event) => { if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100)); };
		xhr.onload = () => {
			let body: any = null;
			try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
			if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
			else reject(new ApiError(body?.error || xhr.responseText || 'Upload failed', xhr.status, body?.code));
		};
		xhr.onerror = () => reject(new ApiError('Upload failed', 0));
		xhr.send(file);
	}),
	downloadEndpoint: async (endpoint: string, filename: string) => {
		const res = await fetch(apiUrl(endpoint), { headers: contextHeaders(), credentials: 'same-origin' });
		if (!res.ok) throw new ApiError('Download failed', res.status);
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	},
	download: async (path: string, filename: string) => api.downloadEndpoint(`/download?path=${encodeURIComponent(path)}`, filename),
	downloadSelectedZip: async (paths: string[], filename: string) => {
		const res = await fetch(apiUrl('/download-zip-selected'), { method: 'POST', headers: { ...contextHeaders(), 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ paths }) });
		if (!res.ok) throw new ApiError('Selected ZIP download failed', res.status);
		const blob = await res.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
		anchor.href = url; anchor.download = filename.endsWith('.zip') ? filename : `${filename || 'selected-items'}.zip`; anchor.click(); URL.revokeObjectURL(url);
	},
	downloadZip: async (path: string, filename: string) => {
		const res = await fetch(apiUrl(`/download-zip?path=${encodeURIComponent(path)}`), { headers: contextHeaders(), credentials: 'same-origin' });
		if (!res.ok) throw new ApiError('ZIP download failed', res.status);
		const blob = await res.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
		anchor.href = url; anchor.download = filename.endsWith('.zip') ? filename : `${filename || 'folder'}.zip`; anchor.click(); URL.revokeObjectURL(url);
	},
	uploadZipExtract: (path: string, file: File, onProgress?: (pct: number) => void) => new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest(); xhr.open('POST', apiUrl(`/upload-zip-extract?path=${encodeURIComponent(path)}`));
		for (const [key, value] of Object.entries(contextHeaders())) xhr.setRequestHeader(key, value);
		xhr.setRequestHeader('Content-Type', 'application/zip');
		xhr.upload.onprogress = (event) => { if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100)); };
		xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new ApiError(xhr.responseText || 'ZIP extract failed', xhr.status)); };
		xhr.onerror = () => reject(new ApiError('ZIP extract failed', 0));
		xhr.send(file);
	}),
	previewStreamUrl: async (path: string) => {
		const blob = await api.previewBlob(path);
		return URL.createObjectURL(blob);
	},
	previewBlob: async (path: string) => {
		const res = await fetch(apiUrl(`/preview?path=${encodeURIComponent(path)}`), { headers: contextHeaders(), credentials: 'same-origin' });
		if (!res.ok) throw new ApiError('Preview failed', res.status);
		return res.blob();
	},
	previewBlobUrl: async (path: string) => {
		const blob = await api.previewBlob(path);
		return URL.createObjectURL(blob);
	}
};
