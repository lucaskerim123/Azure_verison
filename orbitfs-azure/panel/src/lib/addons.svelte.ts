import { api, ApiError } from './api';

export type AddonStatus = {
	id: string;
	name: string;
	description: string;
	installed: boolean;
	attached: boolean;
	parked: boolean;
	status: 'uninstalled' | 'unlicensed' | 'detached' | 'attached';
	licensed: boolean;
	licenseState?: string;
	licenseReason?: string;
	online?: boolean;
	available?: boolean;
	configured?: boolean;
	version?: string | null;
	frontend?: {
		primaryNavigation?: Array<{ label: string; href: string; icon?: string }>;
		routes?: Array<{ path: string; component: string }>;
		slots?: Array<{ slot: string; component: string }>;
		routeGuards?: Array<{ prefix: string; permission?: string; roles?: string[] }>;
		navigationGroups?: Array<{ label: string; icon?: string; order?: number; roles?: string[]; items: Array<{ label: string; href: string; icon?: string; permission?: string; roles?: string[] }> }>;
		adminGroups?: Array<{ label: string; icon?: string; order?: number; roles?: string[]; items: Array<{ label: string; href: string; icon?: string; permission?: string; roles?: string[] }> }>;
	} | null;
};

class AddonsStore {
	addons = $state<AddonStatus[]>([]);
	loaded = $state(false);
	loading = $state(false);

	async load() {
		this.loading = true;
		try {
			const res = await api.get<{ addons: AddonStatus[] }>('/addons/status');
			this.addons = res.addons;
		} catch (err) {
			if (!(err instanceof ApiError && err.status === 401)) this.addons = [];
		} finally {
			this.loaded = true;
			this.loading = false;
		}
	}

	get(id: string) {
		return this.addons.find((a) => a.id === id) ?? null;
	}

	available(id: string) {
		return this.get(id)?.available ?? false;
	}

	attached(id: string) {
		return this.get(id)?.attached ?? false;
	}


	primaryNavigation() {
		return this.addons
			.filter((addon) => {
				if (!addon.available || !addon.installed || !addon.attached) return false;
				if (addon.id === 'mcp' || addon.id === 'sorter') return addon.online === true;
				return true;
			})
			.flatMap((addon) => addon.frontend?.primaryNavigation ?? []);
	}


	navigationGroups() {
		return this.addons
			.filter((addon) => addon.available && addon.installed && addon.attached && addon.licensed)
			.flatMap((addon) => addon.frontend?.navigationGroups ?? []);
	}

	adminGroups() {
		return this.addons
			.filter((addon) => addon.available && addon.installed && addon.attached && addon.licensed)
			.flatMap((addon) => addon.frontend?.adminGroups ?? []);
	}

	routeOwner(pathname: string) {
		return this.addons.find((addon) => addon.available && addon.installed && addon.attached && addon.licensed &&
			(addon.frontend?.routes ?? []).some((route) => pathname === route.path || pathname.startsWith(route.path + '/'))
		)?.id ?? null;
	}

	configurable(id: string) {
		const addon = this.get(id);
		return Boolean(addon?.installed && addon.licensed);
	}
}

export const addons = new AddonsStore();
