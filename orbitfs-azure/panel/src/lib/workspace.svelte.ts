import { api, ApiError } from '$lib/api';
import { fileContext } from '$lib/context.svelte';

export type Workspace = {
	id: string;
	name: string;
	slug: string;
	is_main: boolean;
	permission: 'owner' | 'editor' | 'contributor' | 'viewer';
	status: string;
	drive_state?: string;
};

const STORAGE_KEY = 'orbitfs.workspace';

class WorkspaceStore {
	workspaces = $state<Workspace[]>([]);
	currentId = $state<string | null>(null);
	loaded = $state(false);

	async load() {
		try {
			const selectedBeforeLoad = this.currentId ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null);
			const res = await api.get<{ workspaces: Workspace[] }>('/workspaces');
			this.workspaces = res.workspaces;
			const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
			const preferred = stored ?? selectedBeforeLoad;
			const main = res.workspaces.find((item) => item.is_main);
			this.currentId =
				(preferred && res.workspaces.some((item) => item.id === preferred) ? preferred : null) ??
				main?.id ??
				res.workspaces[0]?.id ??
				null;
			if (this.currentId && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, this.currentId);
			const chosen = res.workspaces.find((item) => item.id === this.currentId);
			fileContext.set(this.currentId, chosen?.name ?? 'Main workspace');
		} catch (err) {
			if (!(err instanceof ApiError && err.status === 401)) {
				this.workspaces = [];
				this.currentId = null;
				fileContext.clear();
			}
		} finally {
			this.loaded = true;
		}
	}

	select(id: string) {
		this.currentId = id;
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
		const chosen = this.workspaces.find((item) => item.id === id);
		fileContext.set(id, chosen?.name ?? 'Workspace');
	}

	get current() {
		return this.workspaces.find((item) => item.id === this.currentId) ?? null;
	}

	get enabled() {
		return this.workspaces.length > 0;
	}
}

export const workspace = new WorkspaceStore();
