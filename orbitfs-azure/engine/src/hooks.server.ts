import { error, type Handle } from '@sveltejs/kit';
import { assertAddonEngineLicensed } from '$lib/server/addon-engine';

export const handle: Handle = async ({ event, resolve }) => {
	const match=event.url.pathname.match(/^\/engines\/([^/]+)(?:\/|$)/);
	if(match?.[1]){
		try{await assertAddonEngineLicensed(decodeURIComponent(match[1]));}
		catch(cause:any){throw error(Number(cause?.status||403),String(cause?.message||'This OrbitFS engine is not licensed.'));}
	}
	return resolve(event);
};
