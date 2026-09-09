<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import { formatBytes, formatDate } from '$lib/format';
	import { iconFor } from '$lib/file-icon';
	import { fileContext } from '$lib/context.svelte';
	import { addons } from '$lib/addons.svelte';
	import { search } from '$lib/search.svelte';
	import { workspace } from '$lib/workspace.svelte';
	import PluginSlot from '$lib/plugin-slot.svelte';
	import WorkspaceFileToolbarActions from '$lib/workspace-file-toolbar-actions.svelte';
	import { Button } from '$lib/components/ui';
	import FolderPicker from '$lib/components/folder-picker.svelte';
	import ShareModal from '$lib/components/share-modal.svelte';
	import PermissionsModal from '$lib/components/permissions-modal.svelte';
	import {
		ChevronRight,
		FolderPlus,
		Upload,
		RefreshCw,
		Download,
		Trash2,
		Pencil,
		Move,
		Link,
		X,
		LoaderCircle,
		HardDrive,
		ShieldCheck,
		Cloud,
		Search,
		FolderOpen,
		ArrowLeft,
		Check,
		LibraryBig
	} from '@lucide/svelte';

	type Entry = {
		name: string;
		type: 'dir' | 'file';
		size?: number;
		mtime?: string;
		system?: boolean;
		protected?: boolean;
		hidden?: boolean;
	};
	type FolderPermissions = {
		read: boolean;
		write: boolean;
		download: boolean;
		move: boolean;
		delete: boolean;
		create: boolean;
		share: boolean;
	};

	const currentPath = $derived(page.url.searchParams.get('path') ?? '');
	const breadcrumbs = $derived(
		currentPath
			? currentPath
					.split('/')
					.filter(Boolean)
					.map((seg, i, arr) => ({
						label: seg,
						path: arr.slice(0, i + 1).join('/')
					}))
			: []
	);

	let entries = $state<Entry[]>([]);
	let folderPermissions = $state<FolderPermissions>({
		read: true,
		write: false,
		download: false,
		move: false,
		delete: false,
		create: false,
		share: false
	});
	const filteredEntries = $derived(
		search.query.trim()
			? entries.filter((e) => e.name.toLowerCase().includes(search.query.trim().toLowerCase()))
			: entries
	);
	let loading = $state(true);
	let error = $state('');
	let creatingFolder = $state(false);
	let newFolderName = $state('');
	let newFolderInput = $state<HTMLInputElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	type UploadJob = {
		id: string;
		file: File;
		name: string;
		pct: number;
		error?: string;
		done?: boolean;
		active?: boolean;
		extractZip?: boolean;
		targetDir: string;
	};
	type DriveConfig = { clientId: string | null; enabled: boolean; configured: boolean };
	type DriveFile = {
		id: string;
		name: string;
		mimeType: string;
		size?: string;
		modifiedTime?: string;
	};
	type DriveCrumb = { id: string; name: string };
	const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
	let uploads = $state<UploadJob[]>([]);
	let uploadPanelOpen = $state(false);
	let uploadExtractZip = $state(false);
	let driveConfig = $state<DriveConfig | null>(null);
	let drivePickerOpen = $state(false);
	let driveLoading = $state(false);
	let driveError = $state('');
	let driveSearch = $state('');
	let driveFiles = $state<DriveFile[]>([]);
	let driveFolderId = $state('root');
	let driveCrumbs = $state<DriveCrumb[]>([{ id: 'root', name: 'My Drive' }]);
	let driveSelected = $state<Set<string>>(new Set());
	let driveAccessToken = $state('');
	let busyPath = $state<string | null>(null);
	let viewerPath = $state<string | null>(null);
	let FileViewerComponent = $state<any>(null);
	let fileViewerLoading = $state(false);
	async function ensureFileViewer() {
		if (FileViewerComponent || fileViewerLoading) return;
		fileViewerLoading = true;
		try { FileViewerComponent = (await import('$lib/components/file-viewer.svelte')).default; }
		finally { fileViewerLoading = false; }
	}
	let sharePath = $state<{ path: string; name: string } | null>(null);
	let renamingPath = $state<string | null>(null);
	let renameValue = $state('');
	let renameInput = $state<HTMLInputElement | null>(null);
	let movePaths = $state<string[] | null>(null);
	let selected = $state<Set<string>>(new Set());
	let bulkBusy = $state(false);
	let trashPurgeBusy = $state(false);
	let canManagePermissions = $state(false);
	let canManageLibrary = $state(false);
	let libraryMessage = $state('');
	let permissionTarget = $state<{ path: string; kind: 'file' | 'folder' } | null>(null);
	const currentWorkspace = $derived(workspace.current);
	const hasWorkspaceChoices = $derived(workspace.workspaces.length > 0);
	const workspaceStatusLabel = $derived(currentWorkspace?.status ?? 'unselected');
	const canEmptyWorkspaceTrash = $derived(
		Boolean(currentWorkspace?.id) && ['owner', 'editor'].includes(currentWorkspace?.permission ?? '')
	);
	const workspaceStatusTone = $derived(
		workspaceStatusLabel === 'active'
			? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
			: workspaceStatusLabel === 'offline'
				? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
				: 'border-border bg-muted/20 text-muted-foreground'
	);

	function joinPath(dir: string, name: string) {
		return dir ? `${dir}/${name}` : name;
	}

	function basename(p: string) {
		return p.split('/').pop() ?? p;
	}

	const driveExports: Record<string, { mimeType: string; ext: string }> = {
		'application/vnd.google-apps.document': {
			mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			ext: '.docx'
		},
		'application/vnd.google-apps.spreadsheet': {
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			ext: '.xlsx'
		},
		'application/vnd.google-apps.presentation': {
			mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			ext: '.pptx'
		},
		'application/vnd.google-apps.drawing': { mimeType: 'image/png', ext: '.png' }
	};

	function driveFilename(file: DriveFile) {
		const exportInfo = driveExports[file.mimeType];
		if (!exportInfo || file.name.toLowerCase().endsWith(exportInfo.ext)) return file.name;
		return `${file.name}${exportInfo.ext}`;
	}

	function driveLabel(file: DriveFile) {
		if (file.mimeType === DRIVE_FOLDER_MIME) return 'Folder';
		if (driveExports[file.mimeType]) return 'Google file';
		return file.size ? formatBytes(Number(file.size)) : 'Drive file';
	}

	const driveSelectedFiles = $derived(driveFiles.filter((file) => driveSelected.has(file.id) && file.mimeType !== DRIVE_FOLDER_MIME));
	const driveUploadEnabled = $derived(driveConfig?.enabled !== false && driveConfig?.configured === true);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api.get<{
				entries: Entry[];
				folderPermissions: FolderPermissions;
				canManagePermissions: boolean;
				canManageLibrary: boolean;
			}>(`/files?subpath=${encodeURIComponent(currentPath)}`);
			folderPermissions = res.folderPermissions;
			canManagePermissions = Boolean(res.canManagePermissions);
			canManageLibrary = Boolean(res.canManageLibrary);
			entries = [...res.entries].sort((a, b) =>
				a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
			);
			selected = new Set();
		} catch (err) {
			const message = err instanceof ApiError ? err.message : 'Failed to load files';
			if (currentPath && /ENOENT|no such file or directory/i.test(message)) {
				entries = [];
				error = '';
				await goto('/', { replaceState: true });
				return;
			}
			error = message;
			entries = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		currentPath;
		fileContext.currentId;
		load();
	});

	$effect(() => {
		if (creatingFolder) void tick().then(() => newFolderInput?.focus());
	});

	$effect(() => {
		if (viewerPath) void ensureFileViewer();
	});

	$effect(() => {
		if (renamingPath) void tick().then(() => renameInput?.focus());
	});

	$effect(() => {
		loadDriveConfig().catch(() => {
			driveConfig = { clientId: null, enabled: false, configured: false };
			drivePickerOpen = false;
		});
	});

	function openFolder(path: string) {
		goto(path ? `/?path=${encodeURIComponent(path)}` : '/');
	}

	async function retryWorkspaceLoad() {
		error = '';
		await workspace.load();
		await load();
	}

	async function loadDriveConfig() {
		if (driveConfig) return driveConfig;
		const config = await api.get<DriveConfig>('/drive-config');
		driveConfig = config;
		return config;
	}

	function loadScript(src: string) {
		return new Promise<void>((resolve, reject) => {
			const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
			if (existing) {
				existing.addEventListener('load', () => resolve(), { once: true });
				if ((window as any).google?.accounts?.oauth2) resolve();
				return;
			}
			const script = document.createElement('script');
			script.src = src;
			script.async = true;
			script.defer = true;
			script.onload = () => resolve();
			script.onerror = () => reject(new ApiError('Could not load Google sign-in runtime', 502));
			document.head.appendChild(script);
		});
	}

	async function requestDriveAccess() {
		const config = await loadDriveConfig();
		if (config.enabled === false) throw new ApiError('Google Drive upload is turned off', 409);
		if (!config.configured || !config.clientId) throw new ApiError('Google Drive client ID is not configured', 409);
		await loadScript('https://accounts.google.com/gsi/client');
		const google = (window as any).google;
		if (!google?.accounts?.oauth2?.initTokenClient) throw new ApiError('Google sign-in runtime is unavailable', 502);
		return await new Promise<string>((resolve, reject) => {
			const client = google.accounts.oauth2.initTokenClient({
				client_id: config.clientId,
				scope: 'https://www.googleapis.com/auth/drive.readonly',
				callback: (response: { access_token?: string; error?: string }) => {
					if (response?.access_token) {
						driveAccessToken = response.access_token;
						resolve(response.access_token);
					} else reject(new ApiError(response?.error || 'Google Drive access was not granted', 403));
				},
				error_callback: () => reject(new ApiError('Google Drive sign-in failed', 403))
			});
			client.requestAccessToken({ prompt: driveAccessToken ? '' : 'consent' });
		});
	}

	function driveQuery(searchText: string) {
		const term = searchText.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
		const clauses = ["trashed = false"];
		if (term) clauses.push(`name contains '${term}'`);
		else clauses.push(`'${driveFolderId.replace(/'/g, "\\'")}' in parents`);
		return clauses.join(' and ');
	}

	async function loadDriveFiles() {
		driveLoading = true;
		driveError = '';
		try {
			const token = driveAccessToken || (await requestDriveAccess());
			const params = new URLSearchParams({
				q: driveQuery(driveSearch),
				pageSize: '25',
				orderBy: 'folder,name',
				fields: 'files(id,name,mimeType,size,modifiedTime)',
				includeItemsFromAllDrives: 'true',
				supportsAllDrives: 'true'
			});
			const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!response.ok) throw new ApiError('Could not load Google Drive files', response.status);
			const body = await response.json().catch(() => ({}));
			driveFiles = Array.isArray(body.files) ? body.files : [];
			driveSelected = new Set([...driveSelected].filter((id) => driveFiles.some((file) => file.id === id)));
		} catch (err) {
			driveError = err instanceof ApiError ? err.message : 'Could not load Google Drive files';
			driveFiles = [];
		} finally {
			driveLoading = false;
		}
	}

	async function openDrivePicker() {
		const config = await loadDriveConfig();
		if (config.enabled === false || !config.configured) {
			drivePickerOpen = false;
			return;
		}
		uploadPanelOpen = true;
		drivePickerOpen = true;
		await loadDriveFiles();
	}

	async function openDriveFolder(file: DriveFile) {
		if (file.mimeType !== DRIVE_FOLDER_MIME) return;
		driveFolderId = file.id;
		driveCrumbs = [...driveCrumbs, { id: file.id, name: file.name }];
		driveSearch = '';
		driveSelected = new Set();
		await loadDriveFiles();
	}

	async function openDriveCrumb(crumb: DriveCrumb) {
		const index = driveCrumbs.findIndex((item) => item.id === crumb.id);
		driveFolderId = crumb.id;
		driveCrumbs = index >= 0 ? driveCrumbs.slice(0, index + 1) : [{ id: 'root', name: 'My Drive' }];
		driveSearch = '';
		driveSelected = new Set();
		await loadDriveFiles();
	}

	async function driveBack() {
		if (driveCrumbs.length <= 1) return;
		await openDriveCrumb(driveCrumbs[driveCrumbs.length - 2]);
	}

	function toggleDriveSelected(file: DriveFile) {
		if (file.mimeType === DRIVE_FOLDER_MIME) return;
		const next = new Set(driveSelected);
		if (next.has(file.id)) next.delete(file.id);
		else next.add(file.id);
		driveSelected = next;
	}

	async function importDriveFile(file: DriveFile) {
		if (file.mimeType === DRIVE_FOLDER_MIME) {
			await openDriveFolder(file);
			return;
		}
		driveError = '';
		const name = driveFilename(file);
		const job: UploadJob = {
			id: `${Date.now()}-${crypto.randomUUID()}`,
			file: new File([], name),
			name: `${name} from Google Drive`,
			pct: 0,
			targetDir: currentPath
		};
		uploads = [job, ...uploads];
		try {
			const token = driveAccessToken || (await requestDriveAccess());
			const exportInfo = driveExports[file.mimeType];
			const downloadUrl = exportInfo
				? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportInfo.mimeType)}`
				: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
			job.pct = 20;
			uploads = [...uploads];
			const response = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
			if (!response.ok) throw new ApiError('Could not download Google Drive file', response.status);
			const blob = await response.blob();
			job.file = new File([blob], name, { type: blob.type || exportInfo?.mimeType || file.mimeType || 'application/octet-stream' });
			await runUpload(job);
			await load();
		} catch (err) {
			job.error = err instanceof ApiError ? err.message : 'Google Drive upload failed';
			uploads = [...uploads];
		}
	}

	async function importSelectedDriveFiles() {
		const files = driveSelectedFiles;
		for (const file of files) await importDriveFile(file);
		driveSelected = new Set();
	}

	async function submitNewFolder() {
		const name = newFolderName.trim();
		if (!name) {
			creatingFolder = false;
			return;
		}
		try {
			await api.post('/mkdir', { path: joinPath(currentPath, name) });
			newFolderName = '';
			creatingFolder = false;
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not create folder';
		}
	}

	async function trash(entry: Entry) {
		const path = joinPath(currentPath, entry.name);
		busyPath = path;
		try {
			await api.post('/trash', { path });
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not delete';
		} finally {
			busyPath = null;
		}
	}

	async function download(entry: Entry) {
		const path = joinPath(currentPath, entry.name);
		try {
			await api.download(path, entry.name);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Download failed';
		}
	}

	async function downloadZip(path: string, name = 'download') {
		busyPath = path;
		try {
			await api.downloadZip(path, `${name || 'download'}.zip`);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'ZIP download failed';
		} finally {
			busyPath = null;
		}
	}

	async function registerInLibrary(entry: Entry, fullPath: string) {
		const workspaceId = String(workspace.currentId || fileContext.currentId || '');
		if (!workspaceId || !canManageLibrary) return;
		busyPath = fullPath;
		libraryMessage = '';
		try {
			const result = await api.post<any>(`/library/workspaces/${encodeURIComponent(workspaceId)}/items`, {
				provider: 'base.files', sourceKind: entry.type === 'dir' ? 'folder' : 'file', path: fullPath, name: entry.name
			});
			libraryMessage = result.existing ? `${entry.name} is already registered in Library.` : `${entry.name} registered in Library.`;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not register in Library';
		} finally { busyPath = null; }
	}

	async function runUpload(job: UploadJob) {
		job.pct = 0; job.error = undefined; job.done = false; job.active = true; uploads = [...uploads];
		const updateProgress = (pct: number) => { job.pct = Math.max(0, Math.min(100, pct)); uploads = [...uploads]; };
		try {
			if (job.extractZip) {
				if (!job.file.name.toLowerCase().endsWith('.zip')) throw new ApiError('Only .zip files can be extracted', 415);
				await api.uploadZipExtract(job.targetDir, job.file, updateProgress);
			} else {
				await api.uploadChunked(`/upload-chunked?path=${encodeURIComponent(joinPath(job.targetDir, job.file.name))}`, job.file, updateProgress);
			}
			job.pct = 100; job.done = true; await load();
		} catch (err) { job.error = err instanceof ApiError ? err.message : 'Upload failed'; }
		finally { job.active = false; uploads = [...uploads]; }
	}

	async function handleFiles(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) return;
		const targetDir = currentPath;
		const jobs = Array.from(fileList).map((file) => ({
			id: `${Date.now()}-${crypto.randomUUID()}`,
			file,
			name: uploadExtractZip ? `${file.name} → extract to /${targetDir || ''}` : file.name,
			pct: 0,
			extractZip: uploadExtractZip && file.name.toLowerCase().endsWith('.zip'),
			targetDir
		}));
		uploads = [...jobs, ...uploads];
		if (fileInput) fileInput.value = '';
		await Promise.allSettled(jobs.map((job) => runUpload(job)));
		await load();
	}

	async function retryUpload(job: UploadJob) {
		await runUpload(job);
		await load();
	}

	function startRename(entry: Entry) {
		startRenamePath(joinPath(currentPath, entry.name));
	}

	function startRenamePath(path: string) {
		viewerPath = null;
		renamingPath = path;
		renameValue = basename(path);
	}

	async function trashPath(path: string) {
		if (!confirm(`Move "${basename(path)}" to trash?`)) return;
		viewerPath = null;
		busyPath = path;
		try {
			await api.post('/trash', { path });
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not delete';
		} finally {
			busyPath = null;
		}
	}

	async function submitRename() {
		if (!renamingPath) return;
		const from = renamingPath;
		const name = renameValue.trim();
		renamingPath = null;
		if (!name || name === basename(from)) return;
		try {
			await api.post('/move', { from, to: joinPath(currentPath, name) });
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Rename failed';
		}
	}

	function toggleSelect(path: string) {
		const next = new Set(selected);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		selected = next;
	}

	function toggleSelectAll() {
		selected =
			selected.size === filteredEntries.length
				? new Set()
				: new Set(
						filteredEntries
							.filter((entry) => !entry.protected)
							.map((e) => joinPath(currentPath, e.name))
					);
	}

	async function confirmMove(destination: string) {
		const paths = movePaths;
		movePaths = null;
		if (!paths) return;
		bulkBusy = true;
		error = '';
		try {
			if (paths.length === 1) {
				await api.post('/move', { from: paths[0], to: joinPath(destination, basename(paths[0])) });
			} else {
				await api.post('/bulk-move', { paths, destination });
			}
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Move failed';
		} finally {
			bulkBusy = false;
		}
	}

	async function bulkTrash() {
		const paths = [...selected];
		if (!confirm(`Move ${paths.length} selected item${paths.length === 1 ? '' : 's'} to trash?`))
			return;
		bulkBusy = true;
		error = '';
		try {
			for (const path of paths) await api.post('/trash', { path });
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Delete failed';
		} finally {
			bulkBusy = false;
		}
	}

	async function bulkDownload() {
		const paths = [...selected];
		bulkBusy = true;
		error = '';
		try {
			await api.post('/bulk-download/validate', { paths });
			for (const p of paths) await api.download(p, basename(p));
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Download failed';
		} finally {
			bulkBusy = false;
		}
	}

	async function bulkDownloadZip() {
		const paths = [...selected];
		bulkBusy = true;
		error = '';
		try {
			const zipBase =
				paths.length === 1 ? basename(paths[0]) || 'root' : basename(currentPath) || 'root';
			await api.downloadSelectedZip(paths, zipBase + '.zip');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'ZIP download failed';
		} finally {
			bulkBusy = false;
		}
	}

	async function emptyWorkspaceTrash() {
		if (!currentWorkspace?.id || !confirm(`Permanently empty trash for ${currentWorkspace.name}?`)) return;
		trashPurgeBusy = true;
		error = '';
		try {
			await api.delete(`/workspaces/${currentWorkspace.id}/trash`);
			if (currentPath.startsWith('_trash')) await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not empty workspace trash';
		} finally {
			trashPurgeBusy = false;
		}
	}
</script>

<div class="mx-auto max-w-[100rem] space-y-2 p-2.5 md:p-3">
	<div class="space-y-2">
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="font-semibold text-foreground">Files</span>
			{#if currentWorkspace}
				<span class="text-muted-foreground">{currentWorkspace.name}</span>
			{/if}
			<span class="rounded-full border px-2 py-0.5 text-[11px] font-medium {workspaceStatusTone}">
				{workspaceStatusLabel}
			</span>
		</div>
		{#if breadcrumbs.length > 0}
			<nav class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
				{#each breadcrumbs as crumb (crumb.path)}
					<button class="truncate hover:text-foreground" onclick={() => openFolder(crumb.path)}>
						{crumb.label}
					</button>
					{#if crumb !== breadcrumbs[breadcrumbs.length - 1]}
						<ChevronRight class="size-3.5 shrink-0" />
					{/if}
				{/each}
			</nav>
		{/if}
		<div class="-mx-1 flex w-[calc(100%+0.5rem)] gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-auto sm:pb-0">
			<Button class="shrink-0" variant="outline" size="sm" onclick={() => openFolder('')} disabled={!currentPath} title="Back to workspace root">
				<HardDrive class="size-4" /><span>Root</span>
			</Button>
			<Button class="shrink-0" variant="outline" size="sm" onclick={() => load()} title="Refresh files">
				<RefreshCw class="size-4" /><span class="hidden xs:inline">Refresh</span>
			</Button>
			<Button
				class="shrink-0"
				variant="outline"
				size="sm"
				onclick={() => (creatingFolder = true)}
				disabled={!folderPermissions.create}
			>
				<FolderPlus class="size-4" /><span class="hidden xs:inline">New folder</span>
			</Button>
			<WorkspaceFileToolbarActions
				currentPath={currentPath}
				canWrite={folderPermissions.write}
				onSaved={load}
			/>
			<Button
				class="shrink-0"
				variant="outline"
				size="sm"
				onclick={() => downloadZip(currentPath, basename(currentPath) || 'root')}
				disabled={!folderPermissions.download}
			>
				<Download class="size-4" /><span class="hidden xs:inline">Download ZIP</span>
			</Button>
			{#if canEmptyWorkspaceTrash}
				<Button
					class="shrink-0"
					variant="outline"
					size="sm"
					onclick={emptyWorkspaceTrash}
					disabled={trashPurgeBusy}
				>
					{#if trashPurgeBusy}
						<LoaderCircle class="size-4 animate-spin" />
					{:else}
						<Trash2 class="size-4" />
					{/if}
					<span class="hidden xs:inline">Empty trash</span>
				</Button>
			{/if}
			<Button
				class="ml-auto shrink-0 bg-red-600 text-white hover:bg-red-500"
				size="sm"
				onclick={() => (uploadPanelOpen = true)}
				disabled={!folderPermissions.create}
			>
				<Upload class="size-4" /><span>Upload</span>
			</Button>
			<input
				bind:this={fileInput}
				type="file"
				accept="*/*"
				multiple
				class="hidden"
				onchange={(e) => handleFiles((e.currentTarget as HTMLInputElement).files)}
			/>
		</div>
	</div>

	{#if selected.size > 0}
		<div
			class="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
		>
			<span class="font-medium">{selected.size} selected</span>
			<div class="ml-auto flex max-w-full gap-1.5 overflow-x-auto">
				<Button
					size="sm"
					variant="outline"
					disabled={bulkBusy || !folderPermissions.download}
					onclick={bulkDownload}
				>
					<Download class="size-4" />Download
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={bulkBusy || !folderPermissions.download}
					onclick={bulkDownloadZip}
				>
					<Download class="size-4" />Download ZIP
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={bulkBusy || !folderPermissions.move}
					onclick={() => (movePaths = [...selected])}
				>
					<Move class="size-4" />Move
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={bulkBusy || !folderPermissions.delete}
					onclick={bulkTrash}
				>
					{#if bulkBusy}<LoaderCircle class="size-4 animate-spin" />{:else}<Trash2
							class="size-4"
						/>{/if}Trash
				</Button>
				<Button size="sm" variant="ghost" onclick={() => (selected = new Set())}>Clear</Button>
			</div>
		</div>
	{/if}

	{#if uploadPanelOpen || uploads.length > 0}
		<div class="space-y-3 rounded-md border border-border bg-card p-3">
			<div class="flex flex-wrap items-center gap-2">
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold">Upload queue</p>
					<p class="text-xs text-muted-foreground">Target: /{currentPath || 'workspace root'}</p>
				</div>
				<label class="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
					<input type="checkbox" bind:checked={uploadExtractZip} /> Extract ZIP after upload
				</label>
				<Button size="sm" onclick={() => fileInput?.click()} disabled={!folderPermissions.create}
					><Upload class="size-4" />Choose files</Button
				>
				{#if driveUploadEnabled}
					<Button
						size="sm"
						variant="outline"
						onclick={openDrivePicker}
						disabled={!folderPermissions.create || driveLoading}
					>
						{#if driveLoading}<LoaderCircle class="size-4 animate-spin" />{:else}<Cloud class="size-4" />{/if}
						Google Drive
					</Button>
				{/if}
				<Button
					size="sm"
					variant="outline"
					onclick={() => (uploads = uploads.filter((u) => !u.done))}>Clear completed</Button
				>
				<Button size="sm" variant="ghost" onclick={() => (uploadPanelOpen = false)}
					><X class="size-4" />Close</Button
				>
			</div>
			{#if drivePickerOpen && driveUploadEnabled}
				<div class="space-y-3 rounded-md border bg-background p-3">
					<div class="flex flex-col gap-2 lg:flex-row lg:items-center">
						<div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
							<Button size="sm" variant="ghost" onclick={driveBack} disabled={driveLoading || driveCrumbs.length <= 1} title="Back">
								<ArrowLeft class="size-4" />
							</Button>
							{#each driveCrumbs as crumb, index (crumb.id)}
								<button
									class="max-w-40 shrink-0 truncate rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:text-foreground"
									disabled={index === driveCrumbs.length - 1 || driveLoading || !!driveSearch.trim()}
									onclick={() => openDriveCrumb(crumb)}
								>
									{crumb.name}
								</button>
								{#if index < driveCrumbs.length - 1}
									<ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
								{/if}
							{/each}
						</div>
						<div class="relative min-w-0 flex-1">
							<Search class="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
							<input
								class="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
								placeholder="Search Drive or leave blank for this folder"
								bind:value={driveSearch}
								onkeydown={(e) => {
									if (e.key === 'Enter') loadDriveFiles();
								}}
							/>
						</div>
						<Button size="sm" variant="outline" onclick={loadDriveFiles} disabled={driveLoading}>
							{#if driveLoading}<LoaderCircle class="size-4 animate-spin" />{:else}<Search class="size-4" />{/if}
							Search
						</Button>
						<Button size="sm" onclick={importSelectedDriveFiles} disabled={driveLoading || driveSelectedFiles.length === 0}>
							<Upload class="size-4" />Import {driveSelectedFiles.length || ''}
						</Button>
						<Button size="sm" variant="ghost" onclick={() => (drivePickerOpen = false)}>
							<X class="size-4" />Close Drive
						</Button>
					</div>
					{#if driveError}
						<p class="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{driveError}</p>
					{:else if driveLoading}
						<div class="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
							<LoaderCircle class="size-4 animate-spin" />Loading Google Drive files...
						</div>
					{:else if driveFiles.length === 0}
						<div class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
							No Google Drive files found.
						</div>
					{:else}
						<div class="max-h-72 space-y-2 overflow-auto pr-1">
							{#each driveFiles as file (file.id)}
								<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border p-2 text-sm">
									{#if file.mimeType === DRIVE_FOLDER_MIME}
										<button
											class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
											aria-label="Open folder"
											title="Open folder"
											onclick={() => openDriveFolder(file)}
										>
											<FolderOpen class="size-4" />
										</button>
									{:else}
										<button
											class="flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
											aria-label={driveSelected.has(file.id) ? 'Deselect file' : 'Select file'}
											title={driveSelected.has(file.id) ? 'Deselect file' : 'Select file'}
											data-selected={driveSelected.has(file.id)}
											onclick={() => toggleDriveSelected(file)}
										>
											{#if driveSelected.has(file.id)}<Check class="size-4" />{:else}<Cloud class="size-4" />{/if}
										</button>
									{/if}
									<button
										class="min-w-0 text-left"
										onclick={() => file.mimeType === DRIVE_FOLDER_MIME ? openDriveFolder(file) : toggleDriveSelected(file)}
									>
										<p class="truncate font-medium">{driveFilename(file)}</p>
										<p class="text-xs text-muted-foreground">
											{driveLabel(file)}{file.modifiedTime ? ` - ${formatDate(file.modifiedTime)}` : ''}
										</p>
									</button>
									{#if file.mimeType === DRIVE_FOLDER_MIME}
										<Button size="sm" variant="outline" onclick={() => openDriveFolder(file)}>
											<FolderOpen class="size-4" />Open
										</Button>
									{:else}
										<Button size="sm" variant="outline" onclick={() => importDriveFile(file)} disabled={!folderPermissions.create}>
											<Upload class="size-4" />Import
										</Button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if uploads.length === 0}
				<div class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
					No files queued.
				</div>
			{:else}
				<div class="space-y-2">
					{#each uploads as u (u.id)}
						<div class="rounded-md border p-2 text-sm">
							<div class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate">{u.name}</span>
								{#if u.error}<Button size="sm" variant="outline" onclick={() => retryUpload(u)}
										>Retry</Button
									>{/if}
								<span class="w-28 shrink-0 text-right text-xs text-muted-foreground"
									>{u.error ?? (u.done ? 'Done' : `${u.pct}%`)}</span
								>
							</div>
							<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
								<div
									class="h-full rounded-full {u.error ? 'bg-destructive' : 'bg-primary'}"
									style="width: {u.pct}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<div
			class="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{error}
			<button onclick={() => (error = '')} aria-label="Dismiss"><X class="size-4" /></button>
		</div>
	{/if}
	{#if libraryMessage}
		<div class="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
			{libraryMessage}
			<button onclick={() => (libraryMessage = '')} aria-label="Dismiss"><X class="size-4" /></button>
		</div>
	{/if}

	<div class="overflow-x-auto rounded-md border border-border bg-card">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-10 text-muted-foreground">
				<LoaderCircle class="size-5 animate-spin" />
				Loading&hellip;
			</div>
		{:else if !currentWorkspace}
			<div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
				<HardDrive class="size-9 text-muted-foreground" />
				<div class="space-y-1">
					<p class="text-sm font-medium">{hasWorkspaceChoices ? 'Workspace selection lost' : 'No workspace available'}</p>
					<p class="text-sm text-muted-foreground">
					{hasWorkspaceChoices
						? 'Files did not recover the active workspace after restart. Reload the workspace list.'
						: 'No workspace is active yet. Finish setup or create a workspace first.'}
					</p>
				</div>
				<Button
					onclick={retryWorkspaceLoad}
					class="inline-flex h-10 items-center"
				>
					<RefreshCw class="mr-2 size-4" />
					Reload files
				</Button>
			</div>
		{:else if creatingFolder || filteredEntries.length > 0}
			<table class="w-full min-w-[34rem] text-[13px]">
				<thead>
					<tr class="border-b border-border text-left text-xs text-muted-foreground">
						<th class="w-8 px-2.5 py-1.5">
							<input
								type="checkbox"
								checked={filteredEntries.length > 0 && selected.size === filteredEntries.length}
								onchange={toggleSelectAll}
								aria-label="Select all"
							/>
						</th>
						<th class="px-2.5 py-1.5 font-medium">Name</th>
						<th class="hidden px-2.5 py-1.5 font-medium sm:table-cell">Modified</th>
						<th class="hidden px-2.5 py-1.5 font-medium sm:table-cell">Size</th>
						<th class="px-2 py-1.5 font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#if creatingFolder}
						<tr class="border-b border-border last:border-0">
							<td class="px-4 py-1.5" colspan="5">
								<form
									class="flex items-center gap-2"
									onsubmit={(e) => {
										e.preventDefault();
										submitNewFolder();
									}}
								>
									<FolderPlus class="size-4 text-muted-foreground" />
									<input
										bind:this={newFolderInput}
										bind:value={newFolderName}
										placeholder="Folder name"
										class="h-7 flex-1 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
										onblur={submitNewFolder}
									/>
								</form>
							</td>
						</tr>
					{/if}
					{#each filteredEntries as entry (entry.name)}
						{@const Icon = iconFor(entry.name, entry.type)}
						{@const fullPath = joinPath(currentPath, entry.name)}
						<tr
							class="group border-b border-border last:border-0 hover:bg-accent/40 {entry.system
								? 'bg-muted/20 text-muted-foreground'
								: ''}"
						>
							<td class="px-4 py-2">
								<input
									type="checkbox"
									checked={selected.has(fullPath)}
									disabled={entry.protected}
									onchange={() => toggleSelect(fullPath)}
									aria-label="Select {entry.name}"
								/>
							</td>
							<td class="px-4 py-2">
								{#if renamingPath === fullPath}
									<form
										class="flex items-center gap-2"
										onsubmit={(e) => {
											e.preventDefault();
											submitRename();
										}}
									>
										<Icon
											class="size-5 shrink-0 {entry.type === 'dir'
												? 'text-amber-400'
												: 'text-sky-400'}"
										/>
										<input
											bind:this={renameInput}
											bind:value={renameValue}
											class="h-7 flex-1 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
											onblur={submitRename}
										/>
									</form>
								{:else if entry.type === 'dir'}
									<button
										class="flex max-w-[14rem] items-center gap-2 text-left font-medium hover:text-primary sm:max-w-none"
										onclick={() => openFolder(fullPath)}
									>
										<Icon
											class="size-5 shrink-0 {entry.type === 'dir'
												? 'text-amber-400'
												: 'text-sky-400'}"
										/>
										<span class="truncate">{entry.name}</span>
									</button>
								{:else}
									<button
										class="flex max-w-[14rem] items-center gap-2 text-left hover:text-primary sm:max-w-none"
										onclick={() => (viewerPath = fullPath)}
									>
										<Icon class="size-4 shrink-0 text-sky-400" />
										<span class="truncate">{entry.name}</span>
									</button>
								{/if}
							</td>
							<td class="hidden whitespace-nowrap px-2.5 py-1.5 text-muted-foreground sm:table-cell">
								{entry.mtime ? formatDate(entry.mtime) : '—'}
							</td>
							<td class="hidden whitespace-nowrap px-2.5 py-1.5 text-muted-foreground sm:table-cell">
								{entry.type === 'file' && entry.size != null ? formatBytes(entry.size) : '—'}
							</td>
							<td class="px-4 py-2">
								<div
									class="flex justify-end gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
								>
									{#if canManageLibrary}
										<button
											class="flex size-7 items-center justify-center rounded-md text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300"
											aria-label="Register {entry.name} in Library"
											title="Register in Library"
											disabled={busyPath === fullPath}
											onclick={() => registerInLibrary(entry, fullPath)}
										>
											<LibraryBig class="size-4" />
										</button>
									{/if}
									{#if !entry.protected && canManagePermissions}
										<button
											class="flex size-7 items-center justify-center rounded-md text-violet-400 hover:bg-violet-500/15 hover:text-violet-300"
											aria-label="Permissions for {entry.name}"
											title="Permissions"
											onclick={() =>
												(permissionTarget = {
													path: fullPath,
													kind: entry.type === 'dir' ? 'folder' : 'file'
												})}
										>
											<ShieldCheck class="size-4" />
										</button>
									{/if}
									{#if !entry.protected}
										<button
											class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
											aria-label="Share"
											title="Share"
											disabled={!folderPermissions.share}
											onclick={() => (sharePath = { path: fullPath, name: entry.name })}
										>
											<Link class="size-4" />
										</button>
										{#if entry.type === 'file'}
											<button
												class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
												aria-label="Download"
												title="Download"
												disabled={!folderPermissions.download}
												onclick={() => download(entry)}
											>
												<Download class="size-4" />
											</button>
										{:else if entry.type === 'dir'}
											<button
												class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
												aria-label="Download folder as ZIP"
												title="Download ZIP"
												disabled={!folderPermissions.download || busyPath === fullPath}
												onclick={() => downloadZip(fullPath, entry.name)}
											>
												<Download class="size-4" />
											</button>
										{/if}
									{/if}
									{#if entry.type === 'dir'}
										<button
											class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
											aria-label="Rename"
											title="Rename"
											disabled={entry.protected || !folderPermissions.move}
											onclick={() => startRename(entry)}
										>
											<Pencil class="size-4" />
										</button>
									{/if}
									<button
										class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
										aria-label="Move"
										title="Move"
										disabled={entry.protected || !folderPermissions.move}
										onclick={() => (movePaths = [fullPath])}
									>
										<Move class="size-4" />
									</button>
									<button
										class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
										aria-label="Delete"
										title="Delete"
										disabled={entry.protected || !folderPermissions.delete || busyPath === fullPath}
										onclick={() => trash(entry)}
									>
										{#if busyPath === fullPath}
											<LoaderCircle class="size-4 animate-spin" />
										{:else}
											<Trash2 class="size-4" />
										{/if}
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div
				class="flex flex-col items-center justify-center gap-1.5 py-10 text-center text-muted-foreground"
			>
				<HardDrive class="size-8" />
				<p class="text-sm">
					{search.query.trim()
						? `No files in this workspace match "${search.query.trim()}".`
						: 'This workspace folder is empty.'}
				</p>
			</div>
		{/if}
	</div>
</div>

{#if viewerPath}
	<PluginSlot slot="file-view-actions" path={viewerPath} name={basename(viewerPath)} kind="file" workspaceId={fileContext.currentId} />
	{#if FileViewerComponent}
	<FileViewerComponent
		path={viewerPath}
		onClose={() => (viewerPath = null)}
		onSaved={load}
		exportAvailable={addons.available('mcp')}
		onAccess={canManagePermissions
			? (path: string) => {
					viewerPath = null;
					permissionTarget = { path, kind: 'file' };
				}
			: undefined}
		onRename={startRenamePath}
		onMove={(path: string) => {
			viewerPath = null;
			movePaths = [path];
		}}
		onShare={(path: string, name: string) => {
			viewerPath = null;
			sharePath = { path, name };
		}}
		onTrash={trashPath}
	/>
	{:else}
		<div class="fixed inset-0 z-40 flex items-center justify-center bg-background text-muted-foreground"><LoaderCircle class="size-6 animate-spin" /> Loading viewer…</div>
	{/if}
{/if}

{#if movePaths}
	<FolderPicker
		title={movePaths.length === 1
			? `Move "${basename(movePaths[0])}"`
			: `Move ${movePaths.length} items`}
		onPick={confirmMove}
		onCancel={() => (movePaths = null)}
	/>
{/if}

{#if sharePath}
	<ShareModal path={sharePath.path} filename={sharePath.name} onClose={() => (sharePath = null)} />
{/if}

{#if permissionTarget}
	<PermissionsModal
		path={permissionTarget.path}
		kind={permissionTarget.kind}
		onClose={() => (permissionTarget = null)}
		onSaved={load}
	/>
{/if}
