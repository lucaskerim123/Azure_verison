<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { kindOf, highlightLangOf } from '$lib/file-type';
	import { Button } from '$lib/components/ui';
	import PdfPreview from '$lib/components/pdf-preview.svelte';
	import { X, Pencil, Eye, Save, Download, LoaderCircle, Move, Link, Trash2, FileOutput, FileMusic, FileVideoCamera, ShieldCheck } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import hljs from 'highlight.js';

	type Permissions = { read: boolean; write: boolean; download: boolean; move: boolean; delete: boolean; create: boolean; share: boolean };

	let {
		path,
		onClose,
		onSaved,
		onRename,
		onMove,
		onAccess,
		onShare,
		onTrash,
		exportAvailable = false,
		onExport
	}: {
		path: string;
		onClose: () => void;
		onSaved?: () => void;
		onRename?: (path: string) => void;
		onMove?: (path: string) => void;
		onAccess?: (path: string) => void;
		onShare?: (path: string, name: string) => void;
		onTrash?: (path: string) => void;
		exportAvailable?: boolean;
		onExport?: (path: string, name: string) => void | Promise<void>;
	} = $props();

	const name = $derived(path.split('/').pop() ?? path);
	const kind = $derived(kindOf(name));

	let loading = $state(true);
	let error = $state('');
	let content = $state('');
	let permissions = $state<Permissions | null>(null);
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let exportError = $state('');
	let actionError = $state('');
	let loadGeneration = 0;

	let blobUrl = $state<string | null>(null);
	let pdfBlob = $state<Blob | null>(null);
	let documentHtml = $state('');
	type SheetPreview = { name: string; rows: string[][]; truncated: boolean };
	let sheetPreviews = $state<SheetPreview[]>([]);
	let activeSheet = $state(0);

	const canEdit = $derived((kind === 'text' || kind === 'markdown' || kind === 'document') && !!permissions?.write);
	const canDownload = $derived(!!permissions?.download);
	const canMove = $derived(!!permissions?.move);
	const canDelete = $derived(!!permissions?.delete);
	const canShare = $derived(!!permissions?.share);
	const isDirty = $derived(editing && draft !== content);

	const renderedMarkdown = $derived.by(() => {
		if (kind !== 'markdown') return '';
		return DOMPurify.sanitize(marked.parse(content, { async: false }) as string);
	});

	const highlighted = $derived.by(() => {
		if (kind !== 'text') return '';
		try {
			const lang = highlightLangOf(name);
			if (hljs.getLanguage(lang)) return hljs.highlight(content, { language: lang }).value;
		} catch {
			// fall through to auto-detect
		}
		return hljs.highlightAuto(content).value;
	});

	function cellText(value: unknown): string {
		if (value == null) return '';
		if (value instanceof Date) return value.toLocaleString();
		if (typeof value !== 'object') return String(value);
		const item = value as { text?: string; result?: unknown; hyperlink?: string; richText?: { text?: string }[] };
		if (item.richText) return item.richText.map((part) => part.text ?? '').join('');
		if (item.result != null) return cellText(item.result);
		return item.text ?? item.hyperlink ?? '';
	}

	async function loadDocument(blob: Blob) {
		const mammoth = await import('mammoth');
		const arrayBuffer = await blob.arrayBuffer();
		const [htmlResult, textResult] = await Promise.all([
			mammoth.convertToHtml({ arrayBuffer }),
			mammoth.extractRawText({ arrayBuffer })
		]);
		documentHtml = DOMPurify.sanitize(htmlResult.value);
		content = textResult.value.replace(/\n+$/, '');
		draft = content;
	}

	async function loadSpreadsheet(blob: Blob) {
		const { Workbook } = await import('exceljs');
		const workbook = new Workbook();
		await workbook.xlsx.load((await blob.arrayBuffer()) as never);
		sheetPreviews = workbook.worksheets.map((worksheet) => {
			const rows: string[][] = [];
			let truncated = worksheet.rowCount > 500 || worksheet.columnCount > 100;
			worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
				if (rowNumber > 500) return;
				const values = Array.isArray(row.values) ? row.values.slice(1, 101).map(cellText) : [];
				rows.push(values);
			});
			return { name: worksheet.name, rows, truncated };
		});
		activeSheet = 0;
	}

	async function load() {
		const generation = ++loadGeneration;
		loading = true;
		error = '';
		saveError = '';
		exportError = '';
		actionError = '';
		editing = false;
		permissions = null;
		content = '';
		draft = '';
		documentHtml = '';
		sheetPreviews = [];
		activeSheet = 0;
		if (blobUrl?.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
		blobUrl = null;
		try {
			permissions = (await api.get<{ permissions: Permissions }>(`/file-access?path=${encodeURIComponent(path)}`)).permissions;
			if (kind === 'text' || kind === 'markdown') {
				const res = await api.get<{ content: string; permissions: Permissions }>(
					`/file?path=${encodeURIComponent(path)}`
				);
				content = res.content;
				permissions = res.permissions;
			} else if (kind === 'document') {
				await loadDocument(await api.previewBlob(path));
			} else if (kind === 'spreadsheet') {
				await loadSpreadsheet(await api.previewBlob(path));
			} else if (kind === 'video' || kind === 'audio') {
				blobUrl = typeof api.previewStreamUrl === 'function'
					? await api.previewStreamUrl(path)
					: await api.previewBlobUrl(path);
			} else if (kind === 'image') {
				blobUrl = await api.previewBlobUrl(path);
			} else if (kind === 'pdf') {
				pdfBlob = await api.previewBlob(path);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load file';
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	}

	$effect(() => {
		path;
		untrack(load);
		return () => {
			loadGeneration += 1;
			if (blobUrl?.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
		};
	});

	function startEdit() {
		draft = content;
		saveError = '';
		editing = true;
	}

	async function save() {
		saving = true;
		saveError = '';
		try {
			if (kind === 'document') {
				await api.put('/document', { path, text: draft });
				content = draft;
				editing = false;
				await load();
			} else {
				await api.put('/file', { path, content: draft });
				content = draft;
				editing = false;
			}
			onSaved?.();
		} catch (err) {
			saveError = err instanceof ApiError ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function exportFile() {
		exportError = '';
		if (!exportAvailable) {
			exportError = 'Export is not available. Install, enable and license the MCP integration to use this feature.';
			return;
		}
		if (!onExport) {
			exportError = 'MCP export integration is available but has not been connected to the panel yet.';
			return;
		}
		try {
			await onExport(path, name);
		} catch (err) {
			exportError = err instanceof ApiError ? err.message : 'Export failed';
		}
	}

	function closeViewer() {
		if (isDirty && !confirm('You have unsaved changes. Discard them?')) return;
		loadGeneration += 1;
		onClose();
	}

	function cancelEdit() {
		if (isDirty && !confirm('Discard unsaved changes?')) return;
		draft = content;
		saveError = '';
		editing = false;
	}

	async function downloadCurrent() {
		actionError = '';
		try {
			await api.download(path, name);
		} catch (err) {
			actionError = err instanceof ApiError ? err.message : 'Download failed';
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && editing) {
			e.preventDefault();
			if (!saving) save();
		}
		if (e.key === 'Escape' && !editing) closeViewer();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fixed inset-0 z-40 flex flex-col bg-background">
	<header class="shrink-0 border-b border-border bg-background">
		<div class="flex h-12 items-center gap-2 px-3">
			<span class="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
			<button
				class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
				onclick={closeViewer}
				aria-label="Close"
				title="Close file"
				type="button"
			>
				<X class="size-4" />Close
			</button>
		</div>
		<div class="flex min-h-11 w-full items-center gap-1 overflow-x-auto overscroll-contain border-t border-border bg-card/60 px-3 py-1.5">
			{#if canEdit}
				{#if editing}
					<Button size="sm" variant="ghost" onclick={cancelEdit}>
						<Eye />View
					</Button>
					<Button size="sm" onclick={save} disabled={saving || !isDirty}>
						{#if saving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save />{/if}
						Save
					</Button>
				{:else}
					<Button size="sm" variant="outline" onclick={startEdit}>
						<Pencil />Edit
					</Button>
				{/if}
			{/if}
			{#if onAccess}
				<Button size="sm" variant="ghost" onclick={() => onAccess?.(path)} aria-label="Access" title="Access and permissions">
					<ShieldCheck />Access
				</Button>
			{/if}
			{#if onShare && canShare}
				<Button size="sm" variant="ghost" onclick={() => onShare?.(path, name)} aria-label="Share" title="Share">
					<Link />Share
				</Button>
			{/if}
			{#if canDownload}
				<Button size="sm" variant="ghost" onclick={downloadCurrent} aria-label="Download" title="Download">
					<Download />Download
				</Button>
			{/if}
			{#if onRename && canMove}
				<Button size="sm" variant="ghost" onclick={() => onRename?.(path)} aria-label="Rename" title="Rename">
					<Pencil />Rename
				</Button>
			{/if}
			{#if onMove && canMove}
				<Button size="sm" variant="ghost" onclick={() => onMove?.(path)} aria-label="Move" title="Move">
					<Move />Move
				</Button>
			{/if}
			{#if onTrash && canDelete}
				<Button size="sm" variant="ghost" onclick={() => onTrash?.(path)} aria-label="Delete" title="Move to trash">
					<Trash2 />Delete
				</Button>
			{/if}
			<Button size="sm" variant="ghost" onclick={exportFile} aria-label="Export" title="Export through MCP">
				<FileOutput />Export
			</Button>
		</div>
	</header>

	{#if saveError}
		<div class="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
			{saveError}
		</div>
	{/if}
	{#if exportError}
		<div class="flex items-center justify-between border-b border-border bg-secondary/50 px-4 py-2 text-sm text-muted-foreground">
			<span>{exportError}</span>
			<button onclick={() => (exportError = '')} aria-label="Dismiss export message"><X class="size-4" /></button>
		</div>
	{/if}
	{#if actionError}
		<div class="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
			<span>{actionError}</span>
			<button onclick={() => (actionError = '')} aria-label="Dismiss action message"><X class="size-4" /></button>
		</div>
	{/if}

	<div class="flex-1 overflow-auto">
		{#if loading}
			<div class="flex h-full items-center justify-center gap-2 text-muted-foreground">
				<LoaderCircle class="size-6 animate-spin" />
				Loading&hellip;
			</div>
		{:else if error}
			<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-destructive">
				<p>{error}</p>
				<Button size="sm" variant="outline" onclick={load}>Retry</Button>
			</div>
		{:else if kind === 'text' || kind === 'markdown' || kind === 'document'}
			{#if editing}
				<textarea
					bind:value={draft}
					spellcheck={kind === 'document' || kind === 'markdown'}
					class="h-full w-full resize-none bg-background p-4 text-sm outline-none {kind === 'document' ? 'font-sans leading-7' : 'font-mono'}"
				></textarea>
			{:else if kind === 'markdown'}
				<div class="prose prose-invert mx-auto max-w-3xl p-6">{@html renderedMarkdown}</div>
			{:else if kind === 'document' && documentHtml}
				<div class="min-h-full bg-muted/30 p-3 md:p-8">
					<article class="prose mx-auto min-h-[70vh] max-w-4xl rounded-lg bg-white px-6 py-8 text-black shadow-xl md:px-12 md:py-10">
						{@html documentHtml}
					</article>
				</div>
			{:else}
				<pre class="overflow-auto p-4 text-sm"><code class="hljs">{@html highlighted}</code></pre>
			{/if}
		{:else if kind === 'spreadsheet' && sheetPreviews.length > 0}
			{@const sheet = sheetPreviews[activeSheet]}
			<div class="flex h-full min-w-0 flex-col">
				<div class="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 pt-2">
					{#each sheetPreviews as item, index (item.name)}
						<button
							class="whitespace-nowrap rounded-t-md border border-b-0 px-3 py-1.5 text-xs {activeSheet === index ? 'border-border bg-background font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
							onclick={() => (activeSheet = index)}
						>{item.name}</button>
					{/each}
				</div>
				<div class="flex-1 overflow-auto">
					<table class="min-w-full border-collapse bg-background text-xs">
						<tbody>
							{#each sheet.rows as row, rowIndex}
								<tr class={rowIndex === 0 ? 'bg-muted/60 font-medium' : ''}>
									<th class="sticky left-0 border border-border bg-muted px-2 py-1 text-right font-normal text-muted-foreground">{rowIndex + 1}</th>
									{#each row as cell}
										<td class="max-w-80 whitespace-pre-wrap border border-border px-2 py-1 align-top">{cell}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if sheet.truncated}
					<div class="shrink-0 border-t border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">Preview limited to the first 500 rows and 100 columns.</div>
				{/if}
			</div>
		{:else if kind === 'image' && blobUrl}
			<div class="flex h-full items-center justify-center p-4">
				<img src={blobUrl} alt={name} class="max-h-full max-w-full object-contain" />
			</div>
		{:else if kind === 'video' && blobUrl}
			<div class="flex h-full items-center justify-center bg-black p-2 md:p-4">
				<div class="flex h-full w-full max-w-6xl flex-col items-center justify-center gap-3">
					<div class="flex items-center gap-2 self-start text-xs text-white/60">
						<FileVideoCamera class="size-4" />
						<span class="truncate">{name}</span>
					</div>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={blobUrl}
						controls
						playsinline
						preload="metadata"
						class="max-h-[calc(100%-2rem)] w-full rounded-lg bg-black shadow-2xl"
						onerror={() => (error = 'This video format or codec cannot be played by this browser.')}
					></video>
				</div>
			</div>
		{:else if kind === 'audio' && blobUrl}
			<div class="flex h-full items-center justify-center p-4">
				<div class="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl">
					<div class="mb-5 flex items-center gap-4">
						<div class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<FileMusic class="size-7" />
						</div>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{name}</p>
							<p class="text-xs text-muted-foreground">Audio file</p>
						</div>
					</div>
					<audio
						src={blobUrl}
						controls
						autoplay
						preload="metadata"
						class="w-full"
						onerror={() => (error = 'This audio format or codec cannot be played by this browser.')}
					></audio>
				</div>
			</div>
		{:else if kind === 'pdf' && pdfBlob}
			<PdfPreview blob={pdfBlob} name={name} />
		{:else}
			<div class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
				<p class="text-sm">This file type can't be viewed here.</p>
				{#if canDownload}
					<Button size="sm" onclick={downloadCurrent}><Download />Download</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>
