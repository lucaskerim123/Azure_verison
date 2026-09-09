import { registerHeaderProvider } from './api';

class FileContextStore {
	currentId = $state<string | null>(null);
	label = $state('Main workspace');

	set(id: string | null, label = 'Main workspace') {
		this.currentId = id;
		this.label = label;
	}

	clear() {
		this.set(null);
	}
}

export const fileContext = new FileContextStore();

registerHeaderProvider((): Record<string, string> => {
	if (!fileContext.currentId) return {};
	return { 'X-Workspace-Id': fileContext.currentId };
});
