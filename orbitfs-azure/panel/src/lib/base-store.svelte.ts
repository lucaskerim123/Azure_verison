export type Workspace = {
	id: string;
	name: string;
	description: string;
	slug: string;
	status: 'active' | 'offline' | 'archived';
	permission: 'owner' | 'editor' | 'contributor' | 'viewer';
	visibility: 'private' | 'shared' | 'public';
	is_main: boolean;
	createdAt: string;
};

export type Profile = {
	id: string;
	workspaceId: string;
	name: string;
	type: string;
	classification: string;
	labels: string[];
	background: string;
	relationship: string;
	notes: string;
	data: Record<string, unknown>;
	updatedAt: string;
};

export type FileEntry = {
	id: string;
	workspaceId: string;
	path: string;
	kind: 'file' | 'folder';
	content: string;
	size: number;
	mimeType: string | null;
	updatedAt: string;
};

type PanelPayload = { workspaces?: any[]; profiles?: any[]; files?: any[]; error?: string };

const workspaceFromApi = (item: any): Workspace => ({
	id: item.id,
	name: item.name,
	description: item.description ?? '',
	slug: item.slug,
	status: item.status ?? 'active',
	permission: item.permission ?? 'viewer',
	visibility: item.visibility ?? 'private',
	is_main: Boolean(item.is_main),
	createdAt: item.created_at
});

const profileFromApi = (item: any): Profile => ({
	id: item.id,
	workspaceId: item.workspace_id,
	name: item.name,
	type: item.type,
	classification: item.classification,
	labels: item.labels ?? [],
	background: item.background ?? '',
	relationship: item.relationship ?? '',
	notes: item.notes ?? '',
	data: item.data ?? {},
	updatedAt: item.updated_at
});

const fileFromApi = (item: any): FileEntry => ({
	id: item.id,
	workspaceId: item.workspace_id,
	path: item.path,
	kind: item.kind,
	content: item.content_text ?? '',
	size: Number(item.size_bytes ?? 0),
	mimeType: item.mime_type ?? null,
	updatedAt: item.updated_at
});

class BaseStore {
	workspaces = $state<Workspace[]>([]);
	profiles = $state<Profile[]>([]);
	files = $state<FileEntry[]>([]);
	currentWorkspaceId = $state('');
	ready = $state(false);
	saving = $state(false);
	error = $state('');

	reset() {
		this.workspaces = [];
		this.profiles = [];
		this.files = [];
		this.currentWorkspaceId = '';
		this.ready = false;
		this.saving = false;
		this.error = '';
	}

	async init() {
		if (this.ready) return;
		await this.reload();
	}

	async reload() {
		try {
			const response = await fetch('/api/panel', { cache: 'no-store' });
			const payload = await response.json() as PanelPayload;
			if (response.status === 401) { this.reset(); return; }
			if (!response.ok) throw new Error(payload.error || 'Base System load failed');
			this.workspaces = (payload.workspaces ?? []).map(workspaceFromApi);
			this.profiles = (payload.profiles ?? []).map(profileFromApi);
			this.files = (payload.files ?? []).map(fileFromApi);
			if (!this.workspaces.some((item) => item.id === this.currentWorkspaceId)) {
				this.currentWorkspaceId = this.workspaces.find((item) => !item.is_main && item.permission === 'owner')?.id ?? this.workspaces[0]?.id ?? '';
			}
			this.error = '';
			this.ready = true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Base System load failed';
			this.ready = true;
		}
	}

	private applyMutation(action: string, payload: Record<string, unknown>, result: any) {
		const item = result?.item;
		if (action === 'workspace.create' && item) {
			const next = workspaceFromApi(item);
			this.workspaces = [...this.workspaces.filter((row) => row.id !== next.id), next];
			return true;
		}
		if (action === 'workspace.update' && item) {
			const next = workspaceFromApi({ ...item, permission: this.workspaces.find((row) => row.id === item.id)?.permission ?? 'owner' });
			this.workspaces = this.workspaces.map((row) => row.id === next.id ? next : row);
			return true;
		}
		if (action === 'workspace.delete') {
			const id = String(payload.id || '');
			this.workspaces = this.workspaces.filter((row) => row.id !== id);
			this.profiles = this.profiles.filter((row) => row.workspaceId !== id);
			this.files = this.files.filter((row) => row.workspaceId !== id);
			if (this.currentWorkspaceId === id) this.currentWorkspaceId = this.workspaces[0]?.id ?? '';
			return true;
		}
		if (action === 'profile.create' && item) {
			const next = profileFromApi(item);
			this.profiles = [next, ...this.profiles.filter((row) => row.id !== next.id)];
			return true;
		}
		if (action === 'profile.update' && item) {
			const next = profileFromApi(item);
			this.profiles = this.profiles.map((row) => row.id === next.id ? next : row);
			return true;
		}
		if (action === 'profile.delete') {
			const id = String(payload.id || '');
			this.profiles = this.profiles.filter((row) => row.id !== id);
			return true;
		}
		if (action === 'file.create' && item) {
			const next = fileFromApi(item);
			this.files = [...this.files.filter((row) => row.id !== next.id), next];
			return true;
		}
		if (action === 'file.update' && item) {
			const next = fileFromApi(item);
			this.files = this.files.map((row) => row.id === next.id ? next : row);
			return true;
		}
		if (action === 'file.delete') {
			const id = String(payload.id || '');
			this.files = this.files.filter((row) => row.id !== id);
			return true;
		}
		return action.startsWith('permission.');
	}

	private async run(action: string, payload: Record<string, unknown> = {}) {
		this.saving = true;
		try {
			const response = await fetch('/api/panel', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, ...payload })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Base System update failed');
			if (!this.applyMutation(action, payload, result)) await this.reload();
			return result;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Base System update failed';
			return null;
		} finally { this.saving = false; }
	}

	get currentWorkspace() {
		return this.workspaces.find((item) => item.id === this.currentWorkspaceId) ?? null;
	}

	selectWorkspace(workspaceId: string) {
		if (this.workspaces.some((item) => item.id === workspaceId)) this.currentWorkspaceId = workspaceId;
	}

	createWorkspace(name: string, description = '') {
		const clean = name.trim();
		if (clean.length < 2) throw new Error('Workspace name must be at least 2 characters');
		void this.run('workspace.create', { name: clean, description, visibility: 'private' }).then((result) => {
			if (result?.item?.id) this.currentWorkspaceId = result.item.id;
		});
	}

	updateWorkspace(workspaceId: string, changes: Partial<Pick<Workspace, 'name' | 'description' | 'status' | 'visibility'>>) {
		void this.run('workspace.update', { id: workspaceId, ...changes });
	}

	deleteWorkspace(workspaceId: string) {
		const workspace = this.workspaces.find((item) => item.id === workspaceId);
		if (!workspace || workspace.is_main) return false;
		void this.run('workspace.delete', { id: workspaceId });
		return true;
	}

	profilesFor(workspaceId = this.currentWorkspaceId) {
		return this.profiles.filter((item) => item.workspaceId === workspaceId);
	}

	createProfile(input: Pick<Profile, 'name' | 'type' | 'classification' | 'labels' | 'background' | 'relationship' | 'notes'>) {
		if (!this.currentWorkspaceId) throw new Error('Select a workspace first');
		if (!input.name.trim()) throw new Error('Profile name is required');
		void this.run('profile.create', { workspaceId: this.currentWorkspaceId, ...input });
	}

	updateProfile(profileId: string, changes: Partial<Profile>) {
		void this.run('profile.update', { id: profileId, ...changes });
	}

	deleteProfile(profileId: string) {
		void this.run('profile.delete', { id: profileId });
	}

	entriesFor(directory = '', workspaceId = this.currentWorkspaceId) {
		const prefix = directory ? `${directory.replace(/\/$/, '')}/` : '';
		return this.files.filter((item) => {
			if (item.workspaceId !== workspaceId || !item.path.startsWith(prefix)) return false;
			return !item.path.slice(prefix.length).includes('/');
		}).sort((a, b) => a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'folder' ? -1 : 1);
	}

	createFolder(directory: string, name: string) {
		if (!name.trim()) throw new Error('Folder name is required');
		void this.run('file.create', { workspaceId: this.currentWorkspaceId, parentPath: directory, name, kind: 'folder' });
	}

	createFile(directory: string, name: string, content = '') {
		if (!name.trim()) throw new Error('File name is required');
		void this.run('file.create', { workspaceId: this.currentWorkspaceId, parentPath: directory, name, kind: 'file', content });
	}

	updateFile(fileId: string, content: string) {
		void this.run('file.update', { id: fileId, content });
	}

	deleteEntry(entry: FileEntry) {
		void this.run('file.delete', { id: entry.id });
	}
}

export const baseStore = new BaseStore();
