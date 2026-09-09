import { json } from '@sveltejs/kit';
import { getBaseSetupState } from '$lib/server/setup';

export async function GET() {
	try {
		const state = await getBaseSetupState();
		return json({
			needsSetup: state.needsSetup,
			setupComplete: state.setupComplete,
			currentStep: state.currentStep,
			coreReady: state.coreReady,
			licenseReady: state.licenseReady,
			ownerExists: state.ownerExists,
			mainWorkspaceId: state.mainWorkspaceId
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Could not read setup status' }, { status: 500 });
	}
}
