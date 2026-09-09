<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';

	let { blob, name }: { blob: Blob; name: string } = $props();
	let container = $state<HTMLDivElement | null>(null);
	let loading = $state(true);
	let error = $state('');
	let pageCount = $state(0);
	let renderedCount = $state(0);
	let generation = 0;

	async function renderPdf(source: Blob, currentGeneration: number) {
		if (!container) return;
		loading = true;
		error = '';
		pageCount = 0;
		renderedCount = 0;
		container.replaceChildren();

		try {
			const pdfjs = await import('pdfjs-dist');
			const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
			pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
			const data = new Uint8Array(await source.arrayBuffer());
			const pdfDocument = await pdfjs.getDocument({ data }).promise;
			if (currentGeneration !== generation) return;
			pageCount = pdfDocument.numPages;

			for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
				if (currentGeneration !== generation || !container) return;
				const page = await pdfDocument.getPage(pageNumber);
				const base = page.getViewport({ scale: 1 });
				const availableWidth = Math.max(280, Math.min(container.clientWidth - 24, 1100));
				const cssScale = availableWidth / base.width;
				const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
				const viewport = page.getViewport({ scale: cssScale * pixelRatio });
				const canvas = document.createElement('canvas');
				canvas.width = Math.ceil(viewport.width);
				canvas.height = Math.ceil(viewport.height);
				canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
				canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
				canvas.style.maxWidth = '100%';
				canvas.className = 'block bg-white shadow-xl';
				canvas.setAttribute('aria-label', `${name} page ${pageNumber}`);
				const context = canvas.getContext('2d', { alpha: false });
				if (!context) throw new Error('Canvas rendering is unavailable');
				container.appendChild(canvas);
				await page.render({ canvasContext: context, viewport, canvas }).promise;
				renderedCount = pageNumber;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to render PDF';
		} finally {
			if (currentGeneration === generation) loading = false;
		}
	}

	$effect(() => {
		blob;
		container;
		if (!blob || !container) return;
		const currentGeneration = ++generation;
		void renderPdf(blob, currentGeneration);
		return () => { generation += 1; };
	});
</script>

<div class="relative min-h-full bg-muted/30">
	{#if loading}
		<div class="sticky top-0 z-10 flex items-center justify-center gap-2 border-b border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
			<LoaderCircle class="size-4 animate-spin" />
			Rendering PDF{pageCount ? ` — ${renderedCount}/${pageCount}` : '…'}
		</div>
	{:else if error}
		<div class="p-6 text-center text-sm text-destructive">{error}</div>
	{:else}
		<div class="sticky top-0 z-10 border-b border-border bg-background/90 px-3 py-2 text-center text-xs text-muted-foreground backdrop-blur">
			{pageCount} page{pageCount === 1 ? '' : 's'}
		</div>
	{/if}
	<div bind:this={container} class="flex min-h-full flex-col items-center gap-4 overflow-auto p-3 md:p-6"></div>
</div>
