<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { workspace } from '$lib/workspace.svelte';
	import ProfileManager from '$lib/components/library/profile-manager.svelte';
	import ContextLibraryPanel from '$lib/components/mcp/context-library-panel.svelte';
	import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '$lib/components/ui';
	import { Archive, Boxes, ContactRound, File as FileIcon, Folder, LibraryBig, Link2, LoaderCircle, Network, Plus, RefreshCw, Save, Search, Settings2, Trash2 } from '@lucide/svelte';

	type Tab = 'knowledge' | 'approvals' | 'records' | 'ccs' | 'profiles' | 'timeline' | 'sections' | 'retrieve' | 'intelligence' | 'lineage' | 'links' | 'usage';
	type ProfileSection = { id:string; title?:string; kind?:string; content?:string };
	type Profile = { id: string; name: string; type?: string; sections?:ProfileSection[] };
	type KnowledgeGroup = { id:string; name:string; description?:string; createdAt?:string; updatedAt?:string };
	type KnowledgeItem = {
		id: string; kind: string; name: string; description?: string; category?: string; groupId?: string | null;
		tags?: string[]; purposes?: string[]; aliases?: string[]; roles?: string[]; lifecycleState?: string; loadMode?: string; targetPriority?: number; currentTarget?: boolean; importance?: number; status: string; visibility?: string; viewerIds?: string[]; editorIds?: string[]; ownerUserId?: string; versionLabel?: string; guards?: { sourceWriteLocked?:boolean; metadataLocked?:boolean; indexingLocked?:boolean; removalLocked?:boolean };
		source: { provider: string; locator: any }; sourceState?: any;
		linkCount?: number; usageCount?: number;
		sectionCount?: number; eventCount?: number; recordCount?: number; changeCount?: number; entityMentionCount?: number; factCount?: number; relationCount?: number; sourceTracking?: any; content?:string; effectiveLifecycleState?:string; effectiveLoadMode?:string; knowledgeArchitecture?:any;
	};
	type KnowledgeLink = { id: string; sourceItemId: string; sourceSectionId?: string | null; targetItemId: string; targetSectionId?: string | null; relation: string; inverseRelation?: string; origin?: string; status?: string; confidence?: number; direction?: string; evidence?: string };
	type KnowledgeSection = { id: string; itemId: string; title: string; level: number; headingPath?: string[]; lineStart: number; lineEnd: number; preview?: string; wordCount?: number; sourceFormat?: string; indexedAt?: string };
	type KnowledgeRecord = { id:string; itemId:string; sectionId:string; type:string; date:string; dateTimeText?:string; title:string; location?:string; people?:{name:string;entityId?:string|null;profileId?:string|null}[]; summary?:string; witnesses?:string; evidence?:string; notes?:string; sourceOrder?:number; reviewStatus?:string; locked?:boolean; profileId?:string; profileName?:string; origin?:string; state?:string; revision?:number; approvalRequestId?:string; approvalOperationId?:string; history?:any[] };
	type KnowledgeEvent = { id: string; itemId: string; sectionId?: string | null; date: string; title: string; description?: string; eventType?: string; origin: string; status: string; confidence?: number };
	type SourceChange = { id: string; itemId: string; indexedAt: string; kind: string; addedSections?: number; changedSections?: number; removedSections?: number };
	type Usage = { id: string; itemId: string; sectionId?: string | null; consumerType: string; consumerId: string; consumerName?: string };
	type KnowledgeEntity = { id: string; kind: string; name: string; aliases?: string[]; profileId?: string | null; itemId?: string | null; linkedItemId?: string | null; profileType?: string | null };
	type EntityMention = { id: string; itemId: string; sectionId: string; entityId: string; count: number; matchedAliases?: string[]; evidence?: string };
	type KnowledgeFact = { id: string; itemId: string; sectionId: string; text: string; status: string; confidence?: number; importance?: number; date?: string | null; entityIds?: string[]; polarity?: number };
	type FactRelation = { id: string; relation: string; sourceFactId: string; targetFactId: string; sourceItemId: string; sourceSectionId: string; targetItemId: string; targetSectionId: string; confidence?: number; status: string; evidence?: string[] };
	type LibraryRole = { id:string; label:string; sourceKinds?:string[]; loadMode?:string; description?:string };
	type LifecycleState = { id:string; label:string; writable?:boolean; description?:string };
	type LibraryHealth = { healthy:boolean; issueCount:number; checkedItems:number; issues:any[]; updatedAt?:string|null };
	type ChangeOperation = { id:string; type:string; status?:string; target?:any; before?:any; after?:any; impact?:any; input?:any };
	type ChangeRequest = { id:string; status:string; source?:any; sourceSnapshot?:any; summary:string; reason?:string; reviewNote?:string; requestedBy?:string; submittedAt?:string; reviewedBy?:string|null; reviewedAt?:string|null; appliedAt?:string|null; error?:string|null; operations:ChangeOperation[]; results?:any[]; audit?:any[] };
	type LibraryData = { workspaceId: string; canManage: boolean; roleDefinitions?: LibraryRole[]; lifecycleDefinitions?: LifecycleState[]; members?: { id: string; username: string; role: string }[]; items: KnowledgeItem[]; groups: KnowledgeGroup[]; categories: string[]; links: KnowledgeLink[]; autoLinks: KnowledgeLink[]; graphLinks: KnowledgeLink[]; usage: Usage[]; sections: KnowledgeSection[]; events: KnowledgeEvent[]; records: KnowledgeRecord[]; sourceHistory: SourceChange[]; entities: KnowledgeEntity[]; entityMentions: EntityMention[]; facts: KnowledgeFact[]; factRelations: FactRelation[]; stats: any; updatedAt?: string | null };

	let activeTab = $state<Tab>('knowledge');
	let advancedOpen = $state(false), libraryImportFile = $state<File | null>(null);
	let data = $state<LibraryData | null>(null);
	let health = $state<LibraryHealth | null>(null);
	let changeRequests = $state<ChangeRequest[]>([]), approvalStatus = $state('active'), expandedRequestId = $state('');
	let profiles = $state<Profile[]>([]);
	let approvalProfileTargets = $state<Record<string,string>>({}), approvalSectionTargets = $state<Record<string,string>>({}), approvalItemTargets = $state<Record<string,string>>({}), approvalNotes = $state<Record<string,string>>({}), approvalEdits = $state<Record<string,{title:string;date:string;category:string;entryType:string;content:string}>>({});
	let loading = $state(false), busy = $state(false), error = $state(''), message = $state('');
	let loadedWorkspaceId = $state('');
	let searchText = $state(''), recordQuery = $state('');
	let groupFilter = $state('all'), lifecycleFilter = $state('all'), roleFilter = $state('all'), attentionOnly = $state(false), coreOnly = $state(false), newGroupName = $state(''), registerGroupId = $state(''), editGroupId = $state('');
	let selectedKnowledgeIds = $state<string[]>([]), bulkGroupId = $state('');
	let selectedItemId = $state('');
	let registerKind = $state<'knowledge' | 'profile'>('knowledge');
	let registerProfileId = $state(''), registerContent = $state('');
	let registerName = $state(''), registerDescription = $state(''), registerCategory = $state('');
	let registerTags = $state(''), registerPurposes = $state(''), registerRoles = $state<string[]>([]), registerLifecycle = $state('unclassified'), registerVisibility = $state('workspace'), registerSharedIds = $state<string[]>([]), registerCustomPurpose = $state('');

	let linkSourceId = $state(''), linkTargetId = $state(''), linkRelation = $state('related_to');
	let sectionQuery = $state(''), sectionItemId = $state(''), selectedSectionId = $state(''), selectedSectionContent = $state('');
	let retrievalQuery = $state(''), retrievalResults = $state<any[]>([]), retrievalBusy = $state(false), retrievalMaxChars = $state(12000), retrievalLimit = $state(12);
	let eventItemId = $state(''), eventSectionId = $state(''), eventDate = $state(''), eventTitle = $state(''), eventDescription = $state('');

	let editName = $state(''), editDescription = $state(''), editCategory = $state(''), editContent = $state('');
	let editTags = $state(''), editPurposes = $state(''), editRoles = $state<string[]>([]), editLifecycle = $state('unclassified'), editAliases = $state(''), editImportance = $state(0.5), editVisibility = $state('workspace'), editVersionLabel = $state(''), editSharedIds = $state<string[]>([]), editCustomPurpose = $state('');
	let editCurrentTarget = $state(false), editTargetPriority = $state(50);
	let guardSourceWrite = $state(false), guardMetadata = $state(false), guardIndexing = $state(false), guardRemoval = $state(false);
	let intelligenceQuery = $state(''), intelligenceStatus = $state<'all' | 'candidate' | 'confirmed'>('all');
	let lineageItemId = $state(''), lineageTargetId = $state(''), lineageRelation = $state<'supersedes' | 'derived_from'>('supersedes'), lineageVersionLabel = $state('');
	let lineageData = $state<any>(null), impactData = $state<any>(null), lineageBusy = $state(false);

	const DEFAULT_CATEGORIES = ['General', 'Core', 'Reference', 'Project', 'Research', 'Documentation', 'Records', 'Planning', 'Communication', 'Personal', 'Other'];
	const DEFAULT_PURPOSES = ['Context', 'Reference', 'Search', 'Retrieval', 'Timeline', 'Documentation', 'Instructions', 'Research', 'Planning', 'Record keeping', 'Source material', 'Review'];

	const primaryTabs: { id: Tab; label: string; icon: any }[] = [
		{ id: 'knowledge', label: 'Knowledge', icon: LibraryBig },
		{ id: 'approvals', label: 'Approvals', icon: Save },
		{ id: 'records', label: 'Records', icon: FileIcon },
		{ id: 'ccs', label: 'CCS', icon: Boxes },
		{ id: 'profiles', label: 'Profiles', icon: ContactRound },
		{ id: 'timeline', label: 'Timeline', icon: Network }
	];
	const advancedTabs: { id: Tab; label: string; icon: any }[] = [
		{ id: 'sections', label: 'Sections', icon: FileIcon }, { id: 'retrieve', label: 'Retrieve', icon: Search },
		{ id: 'intelligence', label: 'Intelligence', icon: Network }, { id: 'lineage', label: 'Lineage', icon: Network },
		{ id: 'links', label: 'Links', icon: Link2 }, { id: 'usage', label: 'Usage', icon: Network }
	];
	const tabs = $derived(advancedOpen ? [...primaryTabs, ...advancedTabs] : primaryTabs);
	const categoryOptions = $derived([...new Set([...DEFAULT_CATEGORIES, ...(data?.categories || []), ...(data?.items || []).map((item) => item.category || '').filter(Boolean)])]);
	const purposeOptions = $derived([...new Set([...DEFAULT_PURPOSES, ...(data?.items || []).flatMap((item) => item.purposes || []).filter(Boolean)])]);
	const selectedItem = $derived(data?.items.find((item) => item.id === selectedItemId) || null);
	const groups = $derived(data?.groups || []);
	const filteredItems = $derived((data?.items || []).filter((item) => {
		if (groupFilter === 'ungrouped' && item.groupId) return false;
		if (groupFilter !== 'all' && groupFilter !== 'ungrouped' && item.groupId !== groupFilter) return false;
		if (lifecycleFilter !== 'all' && (item.effectiveLifecycleState || item.lifecycleState || 'unclassified') !== lifecycleFilter) return false;
		if (roleFilter !== 'all' && !(item.roles || []).includes(roleFilter)) return false;
		if (coreOnly && !(item.roles || []).some((role)=>role === 'core_knowledge' || role === 'core_profile')) return false;
		if (attentionOnly && !health?.issues?.some((issue)=>issue.itemId === item.id)) return false;
		const q = searchText.trim().toLowerCase();
		if (!q) return true;
		return [item.name, item.description, item.category, item.lifecycleState, ...(item.roles || []), ...(item.tags || []), ...(item.purposes || []), ...(item.aliases || [])]
			.some((value) => String(value || '').toLowerCase().includes(q));
	}));
	const filteredApprovals = $derived(changeRequests.filter((request) => approvalStatus === 'all' || (approvalStatus === 'active' ? ['pending','needs_target','approved','applying'].includes(request.status) : request.status === approvalStatus)));
	const filteredSections = $derived((data?.sections || []).filter((section) => {
		if (sectionItemId && section.itemId !== sectionItemId) return false;
		const q = sectionQuery.trim().toLowerCase();
		if (!q) return true;
		return [section.title, section.preview, ...(section.headingPath || [])].some((value) => String(value || '').toLowerCase().includes(q));
	}));
	const filteredRecords = $derived((data?.records || []).filter((record) => {
		const q = recordQuery.trim().toLowerCase();
		if (!q) return true;
		return [record.title, record.date, record.location, record.summary, record.profileName, record.state, ...(record.people || []).map((person) => person.name), itemName(record.itemId)].some((value) => String(value || '').toLowerCase().includes(q));
	}).slice().sort((a,b) => String(a.date).localeCompare(String(b.date)) || Number(a.sourceOrder || 0)-Number(b.sourceOrder || 0)));
	const filteredFacts = $derived((data?.facts || []).filter((fact) => {
		if (fact.status === 'dismissed') return false;
		if (intelligenceStatus !== 'all' && fact.status !== intelligenceStatus) return false;
		const q = intelligenceQuery.trim().toLowerCase();
		if (!q) return true;
		return [fact.text, itemName(fact.itemId), data?.sections.find((section) => section.id === fact.sectionId)?.title].some((value) => String(value || '').toLowerCase().includes(q));
	}));
	function currentWorkspaceId() { return String(workspace.currentId || loadedWorkspaceId || ''); }
	function fail(err: unknown, fallback: string) { error = err instanceof ApiError ? err.message : fallback; }
	function itemName(id: string) { return data?.items.find((item) => item.id === id)?.name || id; }
	function sourceLabel(item:KnowledgeItem){const provider=String(item.source?.provider||'');if(provider==='base.profiles')return `Profile ? ${item.sourceState?.profileType||item.name}`;if(provider==='base.files')return `Legacy file ? /${item.source?.locator?.path||''}`;return provider==='memory.knowledge'?'Memory knowledge':'Library knowledge';}
	function purposeValues(value: string) { return [...new Set(String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean))]; }
	function addPurpose(current: string, value: string) { return [...new Set([...purposeValues(current), value.trim()].filter(Boolean))].join(', '); }
	function removePurpose(current: string, value: string) { return purposeValues(current).filter((entry) => entry !== value).join(', '); }
	function addRegisterPurpose(value: string) { if (value.trim()) registerPurposes = addPurpose(registerPurposes, value); }
	function addEditPurpose(value: string) { if (value.trim()) editPurposes = addPurpose(editPurposes, value); }
	function toggleRole(list:string[], role:string) { return list.includes(role) ? list.filter((entry)=>entry!==role) : [...list, role]; }
	function roleAllowed(role:LibraryRole, kind:string) { return !role.sourceKinds?.length || role.sourceKinds.includes(kind); }
	async function openRecordSource(record: KnowledgeRecord) {
		if(record.origin==='approval_profile_record' || record.profileId){ activeTab='profiles'; message=`Profile record source: ${record.profileName || 'Profile'} → ${record.sectionId || 'records'}.`; return; }
		const section=data?.sections.find((entry)=>entry.id===record.sectionId); if(!section)return;
		advancedOpen=true; activeTab='sections'; await openSection(section);
	}

	function beginEdit(item: KnowledgeItem) {
		selectedItemId = item.id;
		editName = item.name || '';
		editDescription = item.description || '';
		editContent = item.content || '';
		editCategory = item.category || '';
		editGroupId = item.groupId || '';
		editTags = (item.tags || []).join(', ');
		editPurposes = (item.purposes || []).join(', ');
		editRoles = [...(item.roles || [])];
		editLifecycle = item.lifecycleState || 'unclassified';
		editCurrentTarget = item.currentTarget === true;
		editTargetPriority = Number(item.targetPriority || 50);
		editCustomPurpose = '';
		editAliases = (item.aliases || []).join(', ');
		editImportance = Number.isFinite(Number(item.importance)) ? Number(item.importance) : 0.5;
		editVisibility = item.visibility || 'workspace';
		editVersionLabel = item.versionLabel || '';
		editSharedIds = [...(item.viewerIds || [])];
		guardSourceWrite = item.guards?.sourceWriteLocked === true; guardMetadata = item.guards?.metadataLocked === true; guardIndexing = item.guards?.indexingLocked === true; guardRemoval = item.guards?.removalLocked === true;
	}

	async function loadLibrary(workspaceId: string) {
		if (!workspaceId) return;
		loading = true; error = ''; message = '';
		try {
			const [library, profileData, healthData, approvalData] = await Promise.all([
				api.get<LibraryData>(`/library/workspaces/${encodeURIComponent(workspaceId)}`),
				api.get<{ profiles?: Profile[] }>(`/profiles/${encodeURIComponent(workspaceId)}`).catch(() => ({ profiles: [] })),
				api.get<LibraryHealth>(`/library/workspaces/${encodeURIComponent(workspaceId)}/health`).catch(() => null),
				api.get<{ requests?:ChangeRequest[] }>(`/library/workspaces/${encodeURIComponent(workspaceId)}/change-requests`).catch(() => ({ requests: [] }))
			]);
			data = library; profiles = profileData.profiles || []; health = healthData; changeRequests = approvalData.requests || []; loadedWorkspaceId = workspaceId;
			if (selectedItemId && !library.items.some((item) => item.id === selectedItemId)) selectedItemId = '';
		} catch (err) { fail(err, 'Could not load Library'); }
		finally { loading = false; }
	}

	async function refresh() { await loadLibrary(currentWorkspaceId()); }
	function pretty(value:any) { try { return JSON.stringify(value ?? null, null, 2); } catch { return String(value ?? ''); } }
	function approvalProfileId(operation:ChangeOperation) { return approvalProfileTargets[operation.id] || operation.target?.profileId || ''; }
	function approvalSections(operation:ChangeOperation) {
		const profile=profiles.find((entry)=>entry.id===approvalProfileId(operation));
		return profile?.sections || [];
	}
	function approvalSectionId(operation:ChangeOperation) {
		const selected=approvalSectionTargets[operation.id] || operation.target?.sectionId || operation.input?.sectionId || 'records';
		const sections=approvalSections(operation);
		return sections.some((section)=>section.id===selected) ? selected : (sections.find((section)=>section.id==='records')?.id || sections[0]?.id || 'records');
	}
	function approvalRole(operation:ChangeOperation) { return String(operation.impact?.role || operation.input?.role || operation.target?.role || ''); }
	function approvalKind(operation:ChangeOperation) {
		if(operation.type==='profile_record_add') return 'Profile record';
		if(operation.type==='profile_record_revision') return `Profile record ${operation.input?.mode || 'revision'}`;
		const role=approvalRole(operation);
		if(role==='incident_log') return 'Incident';
		if(role==='timeline') return 'Timeline record';
		if(role==='evidence_target') return 'Evidence';
		if(role==='reference_target') return 'Reference / research';
		if(role==='general_record_target') return 'General record';
		return operation.type.replaceAll('_',' ');
	}
	function approvalMethod(operation:ChangeOperation) {
		if(operation.type==='profile_record_add') return 'Append a structured record to the selected Profile section.';
		if(operation.type==='profile_record_revision') return `${String(operation.input?.mode || 'change').replace(/^./,(c)=>c.toUpperCase())} an already-applied Profile Record through a new approval.`;
		if(['append_to_role','append_to_item','knowledge_record_add'].includes(operation.type)) return 'Append a structured Markdown record to the selected canonical Library knowledge item, then re-index it.';
		if(operation.type==='timeline_event_add') return 'Create a structured Library timeline event.';
		if(operation.type==='profile_patch') return 'Update selected Profile fields.';
		return operation.impact?.description || 'Apply this proposed change through Base.';
	}
	function approvalDestinationLabel(operation:ChangeOperation) {
		if(operation.type==='profile_record_add') return 'Profile / section';
		const role=approvalRole(operation);
		if(role==='incident_log') return 'Incident Log destination';
		if(role==='timeline') return 'Timeline destination';
		if(role==='evidence_target') return 'Evidence destination';
		if(role==='reference_target') return 'Reference destination';
		return 'Library destination';
	}
	function approvalTargetItems(operation:ChangeOperation) {
		const role=approvalRole(operation), writable=(data?.items || []).filter((item)=>item.status==='active' && ['current','draft','unclassified'].includes(item.effectiveLifecycleState || item.lifecycleState || 'unclassified'));
		if(!role) return writable;
		const matched=writable.filter((item)=>(item.roles || []).includes(role));
		return matched.length ? matched : writable;
	}
	function approvalItemId(operation:ChangeOperation) { return approvalItemTargets[operation.id] || operation.target?.itemId || ''; }
	function chooseApprovalItem(operation:ChangeOperation,itemId:string) { approvalItemTargets={...approvalItemTargets,[operation.id]:itemId}; }
	function chooseApprovalProfile(operation:ChangeOperation, profileId:string) {
		approvalProfileTargets={...approvalProfileTargets,[operation.id]:profileId};
		const profile=profiles.find((entry)=>entry.id===profileId), preferred=profile?.sections?.find((section)=>section.id==='records')?.id || profile?.sections?.[0]?.id || 'records';
		approvalSectionTargets={...approvalSectionTargets,[operation.id]:preferred};
	}
	async function assignApprovalProfileTarget(request:ChangeRequest, operation:ChangeOperation) {
		const profileId=approvalProfileId(operation), sectionId=approvalSectionId(operation); if(!profileId || !sectionId) return;
		if(!data?.canManage) return; busy=true; error='';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/change-requests/${encodeURIComponent(request.id)}/targets`, { targets:{ [operation.id]:{profileId,sectionId} } }); await refresh(); message='Profile destination updated.'; }
		catch(err){ fail(err,'Could not assign profile destination'); }
		finally{ busy=false; }
	}
	async function decideApproval(request:ChangeRequest, approved:boolean) {
		if (!data?.canManage || !currentWorkspaceId()) return;
		const note=String(approvalNotes[request.id] || '').trim();
		if(!approved && !note){ error='Add a reason before denying this request.'; return; }
		busy=true; error=''; message='';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/change-requests/${encodeURIComponent(request.id)}`, { approved, note }); await refresh(); message=approved?'Approved and applied.':'Denied and returned to author.'; }
		catch(err){ fail(err, approved ? 'Could not approve change' : 'Could not deny request'); }
		finally{ busy=false; }
	}
	async function assignApprovalTarget(request:ChangeRequest, operation:ChangeOperation, itemId:string) {
		if(!data?.canManage || !itemId) return; busy=true; error='';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/change-requests/${encodeURIComponent(request.id)}/targets`, { targets:{ [operation.id]:itemId } }); await refresh(); message='Approval target updated.'; }
		catch(err){ fail(err,'Could not assign target'); }
		finally{ busy=false; }
	}
	async function setApprovalItemTarget(request:ChangeRequest, operation:ChangeOperation) { const itemId=approvalItemId(operation); if(itemId) await assignApprovalTarget(request,operation,itemId); }
	function approvalEdit(operation:ChangeOperation) { const base=operation.input?.recordData || operation.input || {}; return approvalEdits[operation.id] || { title:String(base.title || ''), date:String(base.date || ''), category:String(base.category || ''), content:String(base.content || '') }; }
	function setApprovalEdit(operation:ChangeOperation, field:'title'|'date'|'category'|'content', value:string) { approvalEdits={...approvalEdits,[operation.id]:{...approvalEdit(operation),[field]:value}}; }
	async function saveApprovalEdit(request:ChangeRequest, operation:ChangeOperation) {
		if(!data?.canManage) return; busy=true; error=''; message='';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/change-requests/${encodeURIComponent(request.id)}/operations`, { operationId:operation.id, patch:approvalEdit(operation) }); approvalEdits={...approvalEdits,[operation.id]:undefined as any}; await refresh(); message='Proposal updated and preview rebuilt.'; }
		catch(err){ fail(err,'Could not edit proposed change'); } finally{ busy=false; }
	}
	function canReviseApplied(operation:ChangeOperation){ return ['profile_record_add','profile_record_revision'].includes(operation.type); }
	async function postApprovalAction(request:ChangeRequest, operation:ChangeOperation, action:'change'|'remove'|'restore') {
		if(!data?.canManage || !canReviseApplied(operation)) return;
		if(action==='remove' && !confirm('Create a new approval request to remove this applied record?')) return;
		busy=true; error=''; message='';
		try { const body:any={ action, operationId:operation.id, reason:String(approvalNotes[request.id] || '').trim() }; if(action==='change') body.patch=approvalEdit(operation); await api.post(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/change-requests/${encodeURIComponent(request.id)}/revision`,body); await refresh(); approvalStatus='active'; message=action==='change'?'Revision submitted for approval.':action==='remove'?'Removal submitted for approval.':'Restore submitted for approval.'; }
		catch(err){ fail(err, action==='change'?'Could not create revision':action==='remove'?'Could not create removal request':'Could not create restore request'); }
		finally{ busy=false; }
	}
	async function exportLibrary() {
		const workspaceId=currentWorkspaceId(); if(!workspaceId)return;
		busy=true; error='';
		try { const pack=await api.get<any>(`/library/workspaces/${encodeURIComponent(workspaceId)}/export`); const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`orbitfs-library-${workspaceId}-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); message='Library pack exported.'; }
		catch(err){ fail(err,'Could not export Library'); } finally{ busy=false; }
	}
	async function importLibrary(file:File|null) {
		if(!file||!data?.canManage)return; libraryImportFile=file; busy=true; error=''; message='';
		try { const pack=JSON.parse(await file.text()); const result=await api.post<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/import`,{pack}); message=`Library imported: ${result.mappedItems||0} sources mapped, ${result.errors?.length||0} skipped/failed.`; await refresh(); }
		catch(err){ fail(err,'Could not import Library pack'); } finally{ busy=false; libraryImportFile=null; }
	}
	function toggleAdvanced(){ advancedOpen=!advancedOpen; if(!advancedOpen && advancedTabs.some((tab)=>tab.id===activeTab)) activeTab='knowledge'; }

	async function createKnowledgeGroup() {
		if (!data?.canManage || !newGroupName.trim()) return;
		busy=true; error='';
		try { await api.post(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/groups`, { name:newGroupName.trim() }); newGroupName=''; message='Knowledge group created.'; await refresh(); }
		catch(err){ fail(err,'Could not create Knowledge group'); } finally{ busy=false; }
	}
	async function renameKnowledgeGroup(group:KnowledgeGroup) {
		if (!data?.canManage) return; const name=prompt('Rename Knowledge group',group.name)?.trim(); if(!name||name===group.name)return;
		busy=true; error=''; try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/groups/${encodeURIComponent(group.id)}`,{name}); message='Knowledge group renamed.'; await refresh(); } catch(err){ fail(err,'Could not rename Knowledge group'); } finally{ busy=false; }
	}
	async function deleteKnowledgeGroup(group:KnowledgeGroup) {
		if (!data?.canManage || !confirm(`Delete group "${group.name}"? Knowledge entries will become Ungrouped; nothing is deleted.`)) return;
		busy=true; error=''; try { await api.delete(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/groups/${encodeURIComponent(group.id)}`); if(groupFilter===group.id)groupFilter='all'; message='Knowledge group deleted; its entries are now Ungrouped.'; await refresh(); } catch(err){ fail(err,'Could not delete Knowledge group'); } finally{ busy=false; }
	}

	function toggleKnowledgeSelection(itemId:string){ selectedKnowledgeIds = selectedKnowledgeIds.includes(itemId) ? selectedKnowledgeIds.filter((id)=>id!==itemId) : [...selectedKnowledgeIds,itemId]; }
	function selectVisibleKnowledge(){ selectedKnowledgeIds = [...new Set([...selectedKnowledgeIds,...filteredItems.map((item)=>item.id)])]; }
	function clearKnowledgeSelection(){ selectedKnowledgeIds = []; bulkGroupId=''; }
	async function bulkPatchKnowledge(patch:any,label:string){ if(!data?.canManage||!selectedKnowledgeIds.length)return; busy=true; error=''; const results=await Promise.allSettled(selectedKnowledgeIds.map((id)=>api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(id)}`,patch))); const failed=results.filter((r)=>r.status==='rejected').length; message=failed ? `${label}: ${results.length-failed} updated, ${failed} failed.` : `${label}: ${results.length} updated.`; await refresh(); if(!failed)clearKnowledgeSelection(); busy=false; }
	async function bulkDeleteKnowledge(){ if(!data?.canManage||!selectedKnowledgeIds.length||!confirm(`Remove ${selectedKnowledgeIds.length} selected Knowledge entries from Library? Legacy source files, if any, are not deleted. Protected entries will be skipped.`))return; busy=true; error=''; const results=await Promise.allSettled(selectedKnowledgeIds.map((id)=>api.delete(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(id)}`))); const failed=results.filter((r)=>r.status==='rejected').length; message=failed ? `Bulk remove: ${results.length-failed} removed, ${failed} protected/failed.` : `Bulk remove: ${results.length} removed.`; await refresh(); selectedKnowledgeIds=failed ? selectedKnowledgeIds.filter((_,i)=>results[i].status==='rejected') : []; busy=false; }

	async function registerKnowledge() {
		const workspaceId = currentWorkspaceId();
		if (!workspaceId || !data?.canManage) return;
		if (registerKind === 'knowledge' && !registerContent.trim()) return;
		if (registerKind === 'profile' && !registerProfileId) return;
		busy = true; error = ''; message = '';
		try {
			const body: any = { name: registerName, description: registerDescription, category: registerCategory, groupId: registerGroupId || null, tags: registerTags, purposes: registerPurposes, roles: registerRoles, lifecycleState: registerLifecycle, visibility: registerVisibility, viewerIds:registerVisibility === 'shared' ? registerSharedIds : [] };
			if (registerKind === 'profile') Object.assign(body, { provider: 'base.profiles', profileId: registerProfileId });
			else Object.assign(body, { provider: 'library.native', content: registerContent, contentFormat: 'markdown' });
			const result = await api.post<any>(`/library/workspaces/${encodeURIComponent(workspaceId)}/items`, body);
			message = result.existing ? 'That source is already registered. Opened the existing Knowledge Item.' : 'Knowledge Item created.';
			registerContent = ''; registerProfileId = ''; registerName = ''; registerDescription = ''; registerCategory = ''; registerGroupId = ''; registerTags = ''; registerPurposes = ''; registerRoles = []; registerLifecycle = 'unclassified'; registerCustomPurpose = ''; registerSharedIds = [];
			await refresh(); if (result.item?.id) beginEdit(data!.items.find((item) => item.id === result.item.id) || result.item);
		} catch (err) { fail(err, 'Could not register knowledge'); }
		finally { busy = false; }
	}
	async function saveItem() {
		if (!selectedItem || !data?.canManage) return;
		busy = true; error = ''; message = '';
		try {
			await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(selectedItem.id)}`, {
				name: editName, description: editDescription, category: editCategory, groupId: editGroupId || null, tags: editTags, purposes: editPurposes, roles: editRoles, lifecycleState: editLifecycle, targetPriority: editTargetPriority, currentTarget: editCurrentTarget, aliases: editAliases, importance: editImportance, visibility: editVisibility, viewerIds:editVisibility === 'shared' ? editSharedIds : [], versionLabel: editVersionLabel, guards: { sourceWriteLocked:guardSourceWrite, metadataLocked:guardMetadata, indexingLocked:guardIndexing, removalLocked:guardRemoval }, content: ['library.native','memory.knowledge'].includes(selectedItem.source.provider) ? editContent : undefined
			});
			message = ['library.native','memory.knowledge'].includes(selectedItem.source.provider) ? 'Knowledge content and metadata updated.' : 'Knowledge metadata updated.'; await refresh();
			const updated = data?.items.find((item) => item.id === selectedItem.id); if (updated) beginEdit(updated);
		} catch (err) { fail(err, 'Could not update Knowledge Item'); }
		finally { busy = false; }
	}

	async function saveGuards() {
		if (!selectedItem || !data?.canManage) return;
		busy=true; error=''; message='';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(selectedItem.id)}`, { guards:{ sourceWriteLocked:guardSourceWrite, metadataLocked:guardMetadata, indexingLocked:guardIndexing, removalLocked:guardRemoval } }); message='Knowledge protection updated.'; await refresh(); const updated=data?.items.find((item)=>item.id===selectedItem.id); if(updated) beginEdit(updated); }
		catch(err){ fail(err,'Could not update Knowledge protection'); } finally{ busy=false; }
	}

	async function setItemStatus(item: KnowledgeItem, status: string) {
		if (!data?.canManage) return;
		busy = true; error = '';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(item.id)}`, { status }); await refresh(); }
		catch (err) { fail(err, 'Could not update status'); }
		finally { busy = false; }
	}

	async function removeItem(item: KnowledgeItem) {
		if (!data?.canManage || !confirm(`Remove ${item.name} from Library? Legacy source material, if any, is not deleted.`)) return;
		busy = true; error = '';
		try { await api.delete(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(item.id)}`); selectedItemId = ''; await refresh(); }
		catch (err) { fail(err, 'Could not remove Knowledge Item'); }
		finally { busy = false; }
	}

	async function createLink() {
		if (!data?.canManage || !linkSourceId || !linkTargetId || linkSourceId === linkTargetId) return;
		busy = true; error = ''; message = '';
		try {
			await api.post(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/links`, {
				sourceItemId: linkSourceId, targetItemId: linkTargetId, relation: linkRelation
			});
			message = 'Knowledge link created.'; linkTargetId = ''; await refresh();
		} catch (err) { fail(err, 'Could not create link'); }
		finally { busy = false; }
	}

	async function removeLink(link: KnowledgeLink) {
		if (!data?.canManage) return;
		busy = true; error = '';
		try { await api.delete(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/links/${encodeURIComponent(link.id)}`); await refresh(); }
		catch (err) { fail(err, 'Could not remove link'); }
		finally { busy = false; }
	}

	async function indexOne(item: KnowledgeItem) {
		if (!data?.canManage) return;
		busy = true; error = ''; message = '';
		try {
			const result = await api.post<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(item.id)}/index`, {});
			message = `Indexed ${item.name}: ${result.sectionCount || 0} sections, ${result.eventCount || 0} timeline candidates, ${result.factCount || 0} fact candidates, ${result.entityMentionCount || 0} entity mentions.`;
			await refresh();
		} catch (err) { fail(err, 'Could not index Knowledge Item'); }
		finally { busy = false; }
	}
	async function indexEverything() {
		if (!data?.canManage) return;
		busy = true; error = ''; message = '';
		try {
			const result = await api.post<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/index-all`, {});
			message = `Knowledge index refreshed: ${result.indexed || 0} succeeded, ${result.failed || 0} failed.`;
			await refresh();
		} catch (err) { fail(err, 'Could not refresh Knowledge index'); }
		finally { busy = false; }
	}
	async function openSection(section: KnowledgeSection) {
		selectedSectionId = section.id; selectedSectionContent = ''; error = '';
		try {
			const result = await api.get<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(section.itemId)}/sections/${encodeURIComponent(section.id)}`);
			selectedSectionContent = result.content || '';
		} catch (err) { fail(err, 'Could not resolve section content'); }
	}
	async function retrieveKnowledge() {
		retrievalBusy = true; error = ''; retrievalResults = [];
		try {
			const result = await api.post<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/retrieve`, { query: retrievalQuery, maxChars: retrievalMaxChars, limit: retrievalLimit });
			retrievalResults = result.results || []; message = `Retrieved ${result.resultCount || 0} relevant sections using ${result.returnedChars || 0} characters.`;
		} catch (err) { fail(err, 'Knowledge retrieval failed'); }
		finally { retrievalBusy = false; }
	}
	async function loadLineage(itemId = lineageItemId || selectedItemId) {
		if (!itemId) return;
		lineageBusy = true; error = ''; lineageItemId = itemId;
		try {
			[lineageData, impactData] = await Promise.all([
				api.get<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(itemId)}/lineage`),
				api.get<any>(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(itemId)}/impact`)
			]);
			lineageVersionLabel = data?.items.find((item) => item.id === itemId)?.versionLabel || '';
		} catch (err) { fail(err, 'Could not load Knowledge lineage'); }
		finally { lineageBusy = false; }
	}
	async function addLineage() {
		if (!data?.canManage || !lineageItemId || !lineageTargetId || lineageItemId === lineageTargetId) return;
		lineageBusy = true; error = '';
		try {
			await api.post(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/items/${encodeURIComponent(lineageItemId)}/lineage`, { relation: lineageRelation, targetItemId: lineageTargetId, versionLabel: lineageVersionLabel });
			message = lineageRelation === 'supersedes' ? 'Version lineage updated.' : 'Derivative lineage linked.';
			lineageTargetId = ''; await refresh(); await loadLineage(lineageItemId);
		} catch (err) { fail(err, 'Could not update Knowledge lineage'); }
		finally { lineageBusy = false; }
	}
	async function createTimelineEvent() {
		if (!data?.canManage || !eventItemId || !eventDate || !eventTitle.trim()) return;
		busy = true; error = '';
		try {
			await api.post(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/events`, { itemId: eventItemId, sectionId: eventSectionId || undefined, date: eventDate, title: eventTitle, description: eventDescription });
			eventDate = ''; eventTitle = ''; eventDescription = ''; eventSectionId = ''; message = 'Timeline event linked to Knowledge.'; await refresh();
		} catch (err) { fail(err, 'Could not create timeline event'); }
		finally { busy = false; }
	}
	async function setEventStatus(event: KnowledgeEvent, status: string) {
		if (!data?.canManage) return;
		busy = true; error = '';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/events/${encodeURIComponent(event.id)}`, { status }); await refresh(); }
		catch (err) { fail(err, 'Could not update timeline event'); }
		finally { busy = false; }
	}
	async function setAutoLinkStatus(link: KnowledgeLink, status: string) {
		if (!data?.canManage) return;
		busy = true; error = '';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/auto-links/${encodeURIComponent(link.id)}`, { status }); await refresh(); }
		catch (err) { fail(err, 'Could not update suggested link'); }
		finally { busy = false; }
	}
	async function setFactStatus(fact: KnowledgeFact, status: string) {
		if (!data?.canManage) return; busy = true; error = '';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/facts/${encodeURIComponent(fact.id)}`, { status }); await refresh(); }
		catch (err) { fail(err, 'Could not update fact candidate'); } finally { busy = false; }
	}
	async function setFactRelationStatus(relation: FactRelation, status: string) {
		if (!data?.canManage) return; busy = true; error = '';
		try { await api.patch(`/library/workspaces/${encodeURIComponent(currentWorkspaceId())}/fact-relations/${encodeURIComponent(relation.id)}`, { status }); await refresh(); }
		catch (err) { fail(err, 'Could not update fact relationship'); } finally { busy = false; }
	}
	function entityName(id: string) { return data?.entities.find((entity) => entity.id === id)?.name || id; }
	function factText(id: string) { return data?.facts.find((fact) => fact.id === id)?.text || id; }
	$effect(() => {
		const id = workspace.currentId;
		if (id && id !== loadedWorkspaceId && !loading) void loadLibrary(id);
	});
</script>
<datalist id="knowledge-category-options">{#each categoryOptions as option}<option value={option}></option>{/each}</datalist>
<div class="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 md:p-6">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
		<div>
			<div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><LibraryBig class="size-4" />Base Knowledge System</div>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight">Library</h1>
			<p class="mt-1 max-w-3xl text-sm text-muted-foreground">The central OrbitFS knowledgebase. Canonical Library/Memory content and structured Profiles live here; general workspace files remain separate.</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<select class="min-w-52 rounded-md border bg-background px-3 py-2 text-sm" value={workspace.currentId || ''} onchange={(event) => workspace.select(event.currentTarget.value)} aria-label="Library workspace">{#each workspace.workspaces as ws}<option value={ws.id}>{ws.name}</option>{/each}</select>
			<Button size="sm" variant="outline" onclick={exportLibrary} disabled={busy || !workspace.currentId}>Export</Button>
			{#if data?.canManage}<label class="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent"><span>Import</span><input class="hidden" type="file" accept="application/json,.json" onchange={(event)=>importLibrary(event.currentTarget.files?.[0] || null)} /></label><Button size="sm" variant="outline" onclick={indexEverything} disabled={busy}><Network class="size-4" />Rebuild</Button>{/if}
			<Button size="sm" variant="outline" onclick={refresh} disabled={loading || !workspace.currentId}><RefreshCw class={loading ? 'size-4 animate-spin' : 'size-4'} />Refresh</Button>
		</div>
	</div>

	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if message}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>{/if}

	<div class="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
		{#each tabs as tab}
			<button class="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm" class:bg-accent={activeTab === tab.id} class:font-medium={activeTab === tab.id} onclick={() => (activeTab = tab.id)}>
				<tab.icon class="size-4" />{tab.label}
			</button>
		{/each}
		<button class="ml-auto shrink-0 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent" onclick={toggleAdvanced}>{advancedOpen ? 'Less' : 'More'}</button>
	</div>

	{#if loading && !data}<div class="flex justify-center py-16"><LoaderCircle class="size-6 animate-spin" /></div>{/if}

	{#if data && activeTab === 'knowledge'}
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Knowledge items</p><p class="mt-1 text-2xl font-semibold">{data.stats?.items || 0}</p></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Profiles</p><p class="mt-1 text-2xl font-semibold">{profiles.length}</p></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Structured records</p><p class="mt-1 text-2xl font-semibold">{data.stats?.records || 0}</p></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Timeline events</p><p class="mt-1 text-2xl font-semibold">{data.stats?.events || 0}</p></CardContent></Card>
		</div>

		{#if data.canManage}
			<Card><CardHeader><CardTitle>Create or link Knowledge</CardTitle></CardHeader><CardContent class="space-y-3">
				<div class="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)]">
					<select class="rounded-md border bg-background p-2 text-sm" bind:value={registerKind}>
						<option value="knowledge">Knowledge / Memory</option><option value="profile">Profile</option>
					</select>
					{#if registerKind === 'profile'}
						<select class="rounded-md border bg-background p-2 text-sm" bind:value={registerProfileId}><option value="">Select profile</option>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select>
					{:else}
						<textarea class="min-h-32 w-full rounded-md border bg-background p-3 text-sm" bind:value={registerContent} placeholder="Paste or write the knowledge to store in the workspace Library / Memory"></textarea>
					{/if}
				</div>
				<div class="grid gap-2 md:grid-cols-3"><Input bind:value={registerName} placeholder="Display name (optional)" /><input list="knowledge-category-options" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={registerCategory} placeholder="Category — choose a basic or type your own" /><select class="rounded-md border bg-background p-2 text-sm" bind:value={registerGroupId}><option value="">Ungrouped</option>{#each groups as group}<option value={group.id}>{group.name}</option>{/each}</select></div>
				<div class="rounded-md border p-3"><p class="text-sm font-medium">Purpose</p><p class="mb-2 text-xs text-muted-foreground">Pick common purposes or add your own. Multiple purposes are allowed.</p><div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select class="rounded-md border bg-background p-2 text-sm" onchange={(event) => { if (event.currentTarget.value) { addRegisterPurpose(event.currentTarget.value); event.currentTarget.value = ''; } }}><option value="">Add a common purpose</option>{#each purposeOptions as option}<option value={option}>{option}</option>{/each}</select><Input bind:value={registerCustomPurpose} placeholder="Custom purpose" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRegisterPurpose(registerCustomPurpose); registerCustomPurpose = ''; } }} /><Button type="button" variant="outline" onclick={() => { addRegisterPurpose(registerCustomPurpose); registerCustomPurpose = ''; }} disabled={!registerCustomPurpose.trim()}>Add</Button></div>{#if purposeValues(registerPurposes).length}<div class="mt-2 flex flex-wrap gap-1">{#each purposeValues(registerPurposes) as purpose}<button type="button" class="rounded-full border bg-muted px-2 py-1 text-xs" onclick={() => (registerPurposes = removePurpose(registerPurposes, purpose))}>{purpose} ×</button>{/each}</div>{/if}</div>
				<div class="rounded-md border p-3"><p class="text-sm font-medium">Lifecycle state</p><p class="mb-2 text-xs text-muted-foreground">Controls whether this source is current, final, historical, draft, reference-only or deprecated.</p><select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={registerLifecycle}>{#each data.lifecycleDefinitions || [] as state}<option value={state.id}>{state.label}</option>{/each}</select></div><div class="rounded-md border p-3"><p class="text-sm font-medium">Library roles / destinations</p><p class="mb-2 text-xs text-muted-foreground">Mark what this source is for. Core sources load in full when explicitly selected; destination roles can be resolved by Studio and other add-ons.</p><div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{#each data.roleDefinitions || [] as role}{#if roleAllowed(role, registerKind)}<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" checked={registerRoles.includes(role.id)} onchange={() => (registerRoles = toggleRole(registerRoles, role.id))} /><span><strong>{role.label}</strong><span class="block text-xs text-muted-foreground">{role.description}</span></span></label>{/if}{/each}</div></div>
				<div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem]"><Input bind:value={registerTags} placeholder="Tags, comma separated" /><select class="rounded-md border bg-background p-2 text-sm" bind:value={registerVisibility}><option value="workspace">Workspace</option><option value="private">Private</option><option value="shared">Shared</option></select></div>
				{#if registerVisibility === 'shared'}<div class="rounded-md border p-3"><p class="mb-2 text-xs text-muted-foreground">Share with workspace members</p><div class="flex flex-wrap gap-2">{#each data.members || [] as member}<label class="flex items-center gap-2 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={registerSharedIds.includes(member.id)} onchange={() => (registerSharedIds = registerSharedIds.includes(member.id) ? registerSharedIds.filter((id) => id !== member.id) : [...registerSharedIds, member.id])} />{member.username} ? {member.role}</label>{/each}</div></div>{/if}
				<textarea class="min-h-20 w-full rounded-md border bg-background p-2 text-sm" bind:value={registerDescription} placeholder="Description / what this knowledge is for"></textarea>
				<div class="flex justify-end"><Button onclick={registerKnowledge} disabled={busy || (registerKind === 'profile' ? !registerProfileId : !registerContent.trim())}><Plus class="size-4" />{registerKind === 'profile' ? 'Link profile' : 'Create knowledge'}</Button></div>
			</CardContent></Card>
		{/if}

		{#if data.canManage}<Card><CardHeader><CardTitle>Knowledge groups</CardTitle></CardHeader><CardContent class="space-y-3"><div class="flex gap-2"><Input bind:value={newGroupName} placeholder="New group name" onkeydown={(event)=>{if(event.key==='Enter'){event.preventDefault();createKnowledgeGroup();}}} /><Button onclick={createKnowledgeGroup} disabled={busy||!newGroupName.trim()}><Plus class="size-4" />Create group</Button></div><div class="flex flex-wrap gap-2">{#each groups as group}<div class="flex items-center gap-1 rounded-md border bg-muted/30 p-1 pl-2 text-sm"><span>{group.name}</span><Button size="sm" variant="ghost" onclick={()=>renameKnowledgeGroup(group)} disabled={busy}>Rename</Button><Button size="sm" variant="ghost" onclick={()=>deleteKnowledgeGroup(group)} disabled={busy}><Trash2 class="size-3.5" /></Button></div>{/each}{#if groups.length===0}<span class="text-sm text-muted-foreground">No groups yet. Existing knowledge stays Ungrouped.</span>{/if}</div></CardContent></Card>{/if}

		{#if health && health.issueCount > 0}<Card><CardContent class="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-medium">Library health · {health.issueCount} item{health.issueCount === 1 ? '' : 's'} need attention</p><p class="text-xs text-muted-foreground">Legacy sources, invalid role/type combinations, duplicate Current targets and indexing gaps are surfaced here.</p></div><Button size="sm" variant="outline" onclick={() => (attentionOnly = !attentionOnly)}>{attentionOnly ? 'Show all' : 'Show attention'}</Button></CardContent></Card>{/if}
		<div class="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
			<Card><CardHeader><CardTitle>Knowledge</CardTitle></CardHeader><CardContent class="space-y-3">
				<div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><div class="relative sm:col-span-2 xl:col-span-2"><Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input class="pl-9" bind:value={searchText} placeholder="Search knowledge, roles, lifecycle or tags" /></div><select class="rounded-md border bg-background p-2 text-sm" bind:value={groupFilter}><option value="all">All groups</option><option value="ungrouped">Ungrouped</option>{#each groups as group}<option value={group.id}>{group.name}</option>{/each}</select><select class="rounded-md border bg-background p-2 text-sm" bind:value={lifecycleFilter}><option value="all">All lifecycle states</option>{#each data.lifecycleDefinitions || [] as state}<option value={state.id}>{state.label}</option>{/each}</select><select class="rounded-md border bg-background p-2 text-sm" bind:value={roleFilter}><option value="all">All roles</option>{#each data.roleDefinitions || [] as role}<option value={role.id}>{role.label}</option>{/each}</select></div>
				<div class="flex flex-wrap gap-2"><label class="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"><input type="checkbox" bind:checked={coreOnly} />Core only</label><label class="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"><input type="checkbox" bind:checked={attentionOnly} />Needs attention</label></div>
				{#if data.canManage}<div class="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2"><Button size="sm" variant="outline" onclick={selectVisibleKnowledge} disabled={busy || filteredItems.length===0}>Select visible</Button><Button size="sm" variant="ghost" onclick={clearKnowledgeSelection} disabled={busy || selectedKnowledgeIds.length===0}>Clear</Button><span class="text-xs text-muted-foreground">{selectedKnowledgeIds.length} selected</span>{#if selectedKnowledgeIds.length>0}<select class="min-w-40 rounded-md border bg-background px-2 py-1.5 text-sm" bind:value={bulkGroupId}><option value="">Choose group…</option>{#each groups as group}<option value={group.id}>{group.name}</option>{/each}</select><Button size="sm" variant="outline" onclick={()=>bulkPatchKnowledge({groupId:bulkGroupId},'Move to group')} disabled={busy || !bulkGroupId}>Move to group</Button><Button size="sm" variant="outline" onclick={()=>bulkPatchKnowledge({groupId:null},'Ungroup')} disabled={busy}>Ungroup</Button><Button size="sm" variant="outline" onclick={()=>bulkPatchKnowledge({status:'archived'},'Archive')} disabled={busy}>Archive</Button><Button size="sm" variant="outline" onclick={()=>bulkPatchKnowledge({status:'active'},'Restore')} disabled={busy}>Restore</Button><Button size="sm" variant="destructive" onclick={bulkDeleteKnowledge} disabled={busy}><Trash2 class="size-4" />Delete selected</Button>{/if}</div>{/if}
				{#if filteredItems.length === 0}<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No registered knowledge matches this view.</p>{/if}
				{#each filteredItems as item}
					<div class="flex items-start gap-2 rounded-lg border p-3" class:border-primary={selectedItemId===item.id || selectedKnowledgeIds.includes(item.id)}>
						{#if data.canManage}<input class="mt-3 h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={selectedKnowledgeIds.includes(item.id)} aria-label="Select knowledge item" onclick={(event)=>event.stopPropagation()} onchange={()=>toggleKnowledgeSelection(item.id)} />{/if}
						<button class="min-w-0 flex-1 text-left" onclick={()=>beginEdit(item)}>
							<div class="flex items-start gap-3"><div class="mt-0.5 rounded-md border p-2">{#if item.kind==='folder'}<Folder class="size-4" />{:else if item.kind==='profile'}<ContactRound class="size-4" />{:else}<FileIcon class="size-4" />{/if}</div>
							<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="break-words">{item.name}</strong><span class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">{item.status}</span><span class="rounded border px-1.5 py-0.5 text-[11px] font-medium">{data.lifecycleDefinitions?.find((state)=>state.id===(item.lifecycleState || 'unclassified'))?.label || 'Unclassified'}</span>{#if item.groupId}<span class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{groups.find((group)=>group.id===item.groupId)?.name || 'Group'}</span>{/if}{#each item.roles || [] as role}<span class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{data.roleDefinitions?.find((entry)=>entry.id===role)?.label || role}</span>{/each}</div>
							<p class="mt-1 break-words text-xs text-muted-foreground">{sourceLabel(item)}</p>{#if item.description}<p class="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>{/if}<div class="mt-2 flex flex-wrap gap-1">{#each item.tags || [] as tag}<span class="rounded bg-muted px-1.5 py-0.5 text-[11px]">#{tag}</span>{/each}</div></div>
							<div class="shrink-0 text-right text-[11px] text-muted-foreground"><div>{item.recordCount || 0} records</div><div>{item.usageCount || 0} used by</div></div></div>
						</button>
					</div>
				{/each}
			</CardContent></Card>

			<Card><CardHeader><CardTitle>{selectedItem ? 'Knowledge details' : 'Select an item'}</CardTitle></CardHeader><CardContent class="space-y-3">
				{#if !selectedItem}<p class="text-sm text-muted-foreground">Choose a Knowledge Item to inspect its canonical source, metadata and usage.</p>{:else}
					<div class="rounded-md border bg-muted/30 p-3 text-sm"><p class="font-medium">Canonical source</p><p class="mt-1 break-all text-xs text-muted-foreground">{sourceLabel(selectedItem)}</p><p class="mt-2 text-xs text-muted-foreground">Provider: {selectedItem.source.provider}{selectedItem.source.provider==='base.files'?' ? compatibility only':''}</p></div>
					<label class="space-y-1 text-sm"><span>Name</span><Input bind:value={editName} disabled={!data.canManage} /></label>
					<label class="space-y-1 text-sm"><span>Description</span><textarea class="min-h-24 w-full rounded-md border bg-background p-2" bind:value={editDescription} disabled={!data.canManage}></textarea></label>{#if ['library.native','memory.knowledge'].includes(selectedItem.source.provider)}<label class="space-y-1 text-sm"><span>Knowledge content</span><textarea class="min-h-64 w-full rounded-md border bg-background p-3 font-mono text-sm" bind:value={editContent} disabled={!data.canManage || selectedItem.knowledgeArchitecture?.protection==='locked'}></textarea><span class="text-xs text-muted-foreground">Stored directly in Library/Memory and re-indexed after save.</span></label>{/if}
					<label class="space-y-1 text-sm"><span>Category</span><input list="knowledge-category-options" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={editCategory} disabled={!data.canManage} placeholder="Choose a basic category or type your own" /></label><label class="space-y-1 text-sm"><span>Knowledge group</span><select class="w-full rounded-md border bg-background p-2" bind:value={editGroupId} disabled={!data.canManage}><option value="">Ungrouped</option>{#each groups as group}<option value={group.id}>{group.name}</option>{/each}</select></label>
					<div class="rounded-md border p-3"><p class="text-sm font-medium">Purposes</p><p class="mb-2 text-xs text-muted-foreground">Use the basics or add custom purposes.</p><div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select class="rounded-md border bg-background p-2 text-sm" disabled={!data.canManage} onchange={(event) => { if (event.currentTarget.value) { addEditPurpose(event.currentTarget.value); event.currentTarget.value = ''; } }}><option value="">Add a common purpose</option>{#each purposeOptions as option}<option value={option}>{option}</option>{/each}</select><Input bind:value={editCustomPurpose} disabled={!data.canManage} placeholder="Custom purpose" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEditPurpose(editCustomPurpose); editCustomPurpose = ''; } }} /><Button type="button" variant="outline" onclick={() => { addEditPurpose(editCustomPurpose); editCustomPurpose = ''; }} disabled={!data.canManage || !editCustomPurpose.trim()}>Add</Button></div>{#if purposeValues(editPurposes).length}<div class="mt-2 flex flex-wrap gap-1">{#each purposeValues(editPurposes) as purpose}<button type="button" class="rounded-full border bg-muted px-2 py-1 text-xs" disabled={!data.canManage} onclick={() => (editPurposes = removePurpose(editPurposes, purpose))}>{purpose} ×</button>{/each}</div>{/if}</div>
					<div class="rounded-md border p-3"><p class="text-sm font-medium">Lifecycle state</p><p class="mb-2 text-xs text-muted-foreground">Current items can receive approved additions. Final / Locked and historical states remain available for context but are not update targets.</p><select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={editLifecycle} disabled={!data.canManage}>{#each data.lifecycleDefinitions || [] as state}<option value={state.id}>{state.label}</option>{/each}</select>{#if editLifecycle === 'final_locked'}<p class="mt-2 text-xs font-medium text-primary">Final / Locked blocks edits to the underlying source and protects it from removal. Library options on this panel stay editable.</p>{/if}</div><div class="rounded-md border p-3"><p class="text-sm font-medium">Library roles / destinations</p><p class="mb-2 text-xs text-muted-foreground">These roles are universal. Add-ons resolve the role instead of relying on a particular filename or folder structure.</p><div class="grid gap-2">{#each data.roleDefinitions || [] as role}{#if roleAllowed(role, selectedItem.kind)}<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" checked={editRoles.includes(role.id)} disabled={!data.canManage} onchange={() => (editRoles = toggleRole(editRoles, role.id))} /><span><strong>{role.label}</strong><span class="block text-xs text-muted-foreground">{role.description}</span></span></label>{/if}{/each}</div>{#if editRoles.some((role)=>!['core_knowledge','core_profile'].includes(role))}<div class="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem]"><label class="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" bind:checked={editCurrentTarget} disabled={!data.canManage} />Preferred/current target</label><label class="space-y-1 text-xs"><span>Target priority</span><Input type="number" min="0" max="100" bind:value={editTargetPriority} disabled={!data.canManage} /></label></div>{/if}{#if editRoles.includes('core_knowledge') || editRoles.includes('core_profile')}<p class="mt-2 text-xs font-medium text-primary">Load mode: Full when explicitly selected</p>{/if}</div>
					<label class="space-y-1 text-sm"><span>Tags</span><Input bind:value={editTags} disabled={!data.canManage} /></label>
					<label class="space-y-1 text-sm"><span>Aliases / known names</span><Input bind:value={editAliases} disabled={!data.canManage} placeholder="Comma separated" /></label>
					<label class="space-y-1 text-sm"><span>Version label</span><Input bind:value={editVersionLabel} disabled={!data.canManage} placeholder="e.g. v3, 2026-08, Final" /></label>
					<label class="space-y-1 text-sm"><span>Visibility</span><select class="w-full rounded-md border bg-background p-2" bind:value={editVisibility} disabled={!data.canManage}><option value="workspace">Workspace</option><option value="private">Private</option><option value="shared">Shared</option></select></label>
					{#if editVisibility === 'shared'}<div class="rounded-md border p-3"><p class="mb-2 text-xs text-muted-foreground">Shared with</p><div class="flex flex-wrap gap-2">{#each data.members || [] as member}<label class="flex items-center gap-2 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={editSharedIds.includes(member.id)} disabled={!data.canManage} onchange={() => (editSharedIds = editSharedIds.includes(member.id) ? editSharedIds.filter((id) => id !== member.id) : [...editSharedIds, member.id])} />{member.username}</label>{/each}</div></div>{/if}
					<label class="space-y-1 text-sm"><span>Importance · {Math.round(editImportance * 100)}%</span><Input type="number" min="0" max="1" step="0.05" bind:value={editImportance} disabled={!data.canManage} /></label>
					{#if data.canManage}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><div><p class="text-sm font-medium">Protection</p><p class="text-xs text-muted-foreground">Lifecycle controls the main source lock. These advanced guards do not stop you editing Library-side options.</p></div><Button size="sm" variant="outline" onclick={saveGuards} disabled={busy}>Save protection</Button></div>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" bind:checked={guardSourceWrite} disabled={selectedItem.source.provider !== 'base.files'} /><span><strong>Lock source editing</strong><span class="block text-xs text-muted-foreground">Blocks write, move and delete in Files.</span></span></label>
							<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" bind:checked={guardMetadata} /><span><strong>Lock source metadata automation</strong><span class="block text-xs text-muted-foreground">Stops automated/internal metadata changes. Manual Library options on this panel remain editable.</span></span></label>
							<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" bind:checked={guardIndexing} /><span><strong>Lock re-index</strong><span class="block text-xs text-muted-foreground">Freezes the current derived index until unlocked.</span></span></label>
							<label class="flex items-start gap-2 rounded border p-2 text-sm"><input class="mt-1" type="checkbox" bind:checked={guardRemoval} /><span><strong>Protect from removal</strong><span class="block text-xs text-muted-foreground">Cannot be removed from Library until unlocked.</span></span></label>
						</div>
					</div>{/if}
					<div class="rounded-md border p-3 text-sm"><div class="flex items-center justify-between gap-2"><p class="font-medium">Knowledge index</p>{#if data.canManage}<Button size="sm" variant="outline" onclick={() => indexOne(selectedItem)} disabled={busy}><RefreshCw class="size-4" />Index source</Button>{/if}</div><div class="mt-2 grid grid-cols-3 gap-2 text-center text-xs"><div class="rounded bg-muted p-2"><strong class="block text-base">{selectedItem.recordCount || 0}</strong>records</div><div class="rounded bg-muted p-2"><strong class="block text-base">{selectedItem.eventCount || 0}</strong>events</div><div class="rounded bg-muted p-2"><strong class="block text-base">{selectedItem.changeCount || 0}</strong>changes</div></div>{#if selectedItem.sourceTracking?.indexedAt}<p class="mt-2 text-xs text-muted-foreground">{selectedItem.sourceTracking.sourceFormat || 'unknown'} · indexed {new Date(selectedItem.sourceTracking.indexedAt).toLocaleString()}</p>{/if}</div>					<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><p class="text-sm font-medium">Recent source changes</p><span class="text-xs text-muted-foreground">{selectedItem.changeCount || 0} recorded</span></div><div class="mt-2 space-y-1 text-xs text-muted-foreground">{#each data.sourceHistory.filter((entry) => entry.itemId === selectedItem.id).slice(-5).reverse() as change}<div class="rounded bg-muted/40 p-2"><span class="font-medium text-foreground">{change.kind === 'initial_index' ? 'Initial index' : 'Source changed'}</span> · {new Date(change.indexedAt).toLocaleString()} · +{change.addedSections || 0} / ~{change.changedSections || 0} / -{change.removedSections || 0} sections</div>{/each}{#if !data.sourceHistory.some((entry) => entry.itemId === selectedItem.id)}<div>No index history yet.</div>{/if}</div></div><div class="rounded-md border p-3"><p class="text-sm font-medium">Used by</p><div class="mt-2 space-y-1 text-xs text-muted-foreground">
						{#each data.links.filter((link) => link.sourceItemId === selectedItem.id || link.targetItemId === selectedItem.id) as link}<div>Link · {itemName(link.sourceItemId)} {link.relation} {itemName(link.targetItemId)}</div>{/each}
						{#each data.usage.filter((entry) => entry.itemId === selectedItem.id) as entry}<div>{entry.consumerType} · {entry.consumerName || entry.consumerId}</div>{/each}
						{#if !(selectedItem.linkCount || selectedItem.usageCount)}<div>Not used anywhere else yet.</div>{/if}
					</div></div>
					{#if data.canManage}<div class="flex flex-wrap gap-2"><Button onclick={saveItem} disabled={busy}><Save class="size-4" />Save metadata</Button><Button variant="outline" onclick={() => setItemStatus(selectedItem, selectedItem.status === 'archived' ? 'active' : 'archived')} disabled={busy}><Archive class="size-4" />{selectedItem.status === 'archived' ? 'Restore' : 'Archive'}</Button><Button variant="destructive" onclick={() => removeItem(selectedItem)} disabled={busy}><Trash2 class="size-4" />Remove</Button></div>{/if}
				{/if}
			</CardContent></Card>
		</div>
	{/if}

	{#if data && activeTab === 'approvals'}
		<Card><CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Change approvals</CardTitle><p class="mt-1 text-sm text-muted-foreground">Review the source, proposed content, exact destination and write method before Base changes authoritative data.</p></div><select class="rounded-md border bg-background p-2 text-sm" bind:value={approvalStatus}><option value="active">Active</option><option value="all">All</option><option value="pending">Pending</option><option value="needs_target">Needs target</option><option value="denied">Denied / returned</option><option value="changes_requested">Changes requested (legacy)</option><option value="applied">Applied</option><option value="rejected">Rejected (legacy)</option><option value="stale">Stale</option><option value="failed">Failed</option></select></div></CardHeader><CardContent class="space-y-3">
			{#if filteredApprovals.length === 0}<p class="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No change requests match this view.</p>{/if}
			{#each filteredApprovals as request (request.id)}
				<article class="rounded-xl border p-3 sm:p-4">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="break-words text-base">{request.summary}</strong><span class="rounded border px-2 py-0.5 text-xs font-medium">{request.status.replaceAll('_',' ')}</span></div><p class="mt-1 break-words text-xs text-muted-foreground">Source: {request.source?.system || 'unknown'}{request.source?.title ? ` · ${request.source.title}` : ''}{request.source?.revision ? ` · revision ${request.source.revision}` : ''}</p><p class="mt-1 text-xs text-muted-foreground">Requested by {request.requestedBy || 'unknown'}{request.submittedAt ? ` · ${new Date(request.submittedAt).toLocaleString()}` : ''}</p>{#if request.reason}<p class="mt-2 text-sm text-muted-foreground">Requester note: {request.reason}</p>{/if}{#if request.reviewNote}<p class="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm"><strong>Review response:</strong> {request.reviewNote}</p>{/if}{#if request.error}<p class="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{request.error}</p>{/if}</div><Button size="sm" variant="outline" onclick={() => (expandedRequestId = expandedRequestId === request.id ? '' : request.id)}>{expandedRequestId === request.id ? 'Collapse' : 'Review details'}</Button></div>

					{#if expandedRequestId === request.id}
						<div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div class="rounded-md border p-3"><p class="text-xs font-semibold uppercase text-muted-foreground">Entry type</p><p class="mt-1 text-sm font-medium">{request.sourceSnapshot?.type || request.source?.type || 'Unknown'}</p></div><div class="rounded-md border p-3"><p class="text-xs font-semibold uppercase text-muted-foreground">Category</p><p class="mt-1 text-sm font-medium">{request.sourceSnapshot?.category || '?'}</p></div><div class="rounded-md border p-3"><p class="text-xs font-semibold uppercase text-muted-foreground">Entry date</p><p class="mt-1 text-sm font-medium">{request.sourceSnapshot?.entryDate || '?'}</p></div><div class="rounded-md border p-3"><p class="text-xs font-semibold uppercase text-muted-foreground">Source status</p><p class="mt-1 text-sm font-medium">{request.source?.status || '?'}</p></div></div>
						{#if request.sourceSnapshot?.content}<div class="mt-3 rounded-md border p-3"><div class="mb-2 flex items-center justify-between gap-2"><p class="text-xs font-semibold uppercase text-muted-foreground">Original Studio content</p><span class="text-xs text-muted-foreground">revision {request.sourceSnapshot?.revision || request.source?.revision || '?'}</span></div><div class="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{request.sourceSnapshot.content}</div></div>{/if}
					{/if}

					<div class="mt-4 space-y-3">{#each request.operations as operation (operation.id)}
						<div class="rounded-lg border bg-muted/10 p-3 sm:p-4">
							<div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong>{approvalKind(operation)}</strong>{#if operation.status}<span class="rounded border px-1.5 py-0.5 text-[11px]">{operation.status.replaceAll('_',' ')}</span>{/if}</div><p class="mt-1 text-sm text-muted-foreground">{approvalMethod(operation)}</p></div><span class="rounded-md border px-2 py-1 text-xs">{operation.impact?.action || 'Change'}</span></div>

							<div class="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4"><div class="rounded-md border bg-background p-2"><span class="text-muted-foreground">Target system</span><strong class="block break-words text-sm">{operation.impact?.targetSystem || operation.target?.system || 'Not selected'}</strong></div><div class="rounded-md border bg-background p-2"><span class="text-muted-foreground">Destination</span><strong class="block break-words text-sm">{operation.impact?.targetItem || operation.target?.itemName || operation.target?.profileName || 'Not selected'}</strong></div><div class="rounded-md border bg-background p-2"><span class="text-muted-foreground">Exact location</span><strong class="block break-all text-sm">{operation.impact?.targetPath || operation.impact?.targetSection || operation.target?.path || operation.target?.sectionTitle || operation.target?.sectionId || approvalRole(operation) || '?'}</strong></div><div class="rounded-md border bg-background p-2"><span class="text-muted-foreground">Record type</span><strong class="block text-sm">{operation.input?.entryType || operation.input?.recordType || request.sourceSnapshot?.type || 'general'}</strong></div></div>

							{#if operation.type === 'profile_record_add' && data.canManage && ['pending','needs_target'].includes(request.status)}
								<div class="mt-3 rounded-md border border-primary/30 p-3"><p class="text-sm font-medium">Profile Record destination</p><p class="mb-2 text-xs text-muted-foreground">Choose the exact Profile and exact Profile section. This record will be appended only to that section.</p><div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select class="min-w-0 rounded-md border bg-background p-2 text-sm" value={approvalProfileId(operation)} onchange={(event)=>chooseApprovalProfile(operation,event.currentTarget.value)}><option value="">Choose profile?</option>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select><select class="min-w-0 rounded-md border bg-background p-2 text-sm" value={approvalSectionId(operation)} onchange={(event)=>approvalSectionTargets={...approvalSectionTargets,[operation.id]:event.currentTarget.value}} disabled={!approvalProfileId(operation)}><option value="">Choose section?</option>{#each approvalSections(operation) as section}<option value={section.id}>{section.title || section.id}</option>{/each}</select><Button size="sm" variant="outline" onclick={()=>assignApprovalProfileTarget(request,operation)} disabled={busy || !approvalProfileId(operation) || !approvalSectionId(operation)}>Set destination</Button></div>{#if operation.target?.profileName}<p class="mt-2 text-xs text-muted-foreground">Current destination: <strong class="text-foreground">{operation.target.profileName}</strong> → <strong class="text-foreground">{operation.target.sectionTitle || operation.target.sectionId}</strong></p>{/if}</div>
							{:else if ['append_to_role','append_to_item','knowledge_record_add'].includes(operation.type) && data.canManage && ['pending','needs_target'].includes(request.status)}
								<div class="mt-3 rounded-md border border-primary/30 p-3"><p class="text-sm font-medium">{approvalDestinationLabel(operation)}</p><p class="mb-2 text-xs text-muted-foreground">Role: <code>{approvalRole(operation) || 'none'}</code>. You can correct the destination before approval; the preview is rebuilt against the selected Knowledge Item.</p><div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><select class="min-w-0 rounded-md border bg-background p-2 text-sm" value={approvalItemId(operation)} onchange={(event)=>chooseApprovalItem(operation,event.currentTarget.value)}><option value="">Choose destination?</option>{#each approvalTargetItems(operation) as item}<option value={item.id}>{item.name} · {item.lifecycleState || 'unclassified'}{(item.roles || []).includes(approvalRole(operation)) ? ' · role match' : ''}</option>{/each}</select><Button size="sm" variant="outline" onclick={()=>setApprovalItemTarget(request,operation)} disabled={busy || !approvalItemId(operation)}>Set destination</Button></div></div>
							{/if}

							{#if expandedRequestId === request.id && data.canManage && ['pending','needs_target'].includes(request.status)}
								<div class="mt-3 rounded-md border p-3"><div class="mb-2"><p class="text-sm font-medium">Reviewer edits</p><p class="text-xs text-muted-foreground">Edit the proposed content and metadata without changing the request type. {approvalKind(operation)} remains {approvalKind(operation)}. Saving rebuilds the exact Before/After preview and records the reviewer edit in the audit trail.</p></div><div class="grid gap-2 sm:grid-cols-3"><Input value={approvalEdit(operation).title} oninput={(event)=>setApprovalEdit(operation,'title',event.currentTarget.value)} placeholder="Record title" /><Input type="date" value={approvalEdit(operation).date} oninput={(event)=>setApprovalEdit(operation,'date',event.currentTarget.value)} /><Input value={approvalEdit(operation).category} oninput={(event)=>setApprovalEdit(operation,'category',event.currentTarget.value)} placeholder="Category" /></div><div class="mt-2 rounded-md border bg-muted/30 p-2 text-xs"><span class="text-muted-foreground">Request type:</span> <strong>{approvalKind(operation)}</strong> <span class="text-muted-foreground">· locked</span></div><textarea class="mt-2 min-h-40 w-full rounded-md border bg-background p-3 text-sm" value={approvalEdit(operation).content} oninput={(event)=>setApprovalEdit(operation,'content',event.currentTarget.value)} placeholder="Proposed content"></textarea><div class="mt-2 flex justify-end"><Button size="sm" variant="outline" onclick={()=>saveApprovalEdit(request,operation)} disabled={busy}>Save edits & rebuild preview</Button></div></div>
							{/if}

							{#if expandedRequestId === request.id && data.canManage && request.status==='applied' && canReviseApplied(operation)}
								<div class="mt-3 rounded-md border border-primary/30 p-3"><div class="mb-2"><p class="text-sm font-medium">Applied record controls</p><p class="text-xs text-muted-foreground">Changes are never made directly. Revise, Remove and Restore each create a new approval while preserving this applied version in history.</p></div>
								{#if !(operation.type==='profile_record_revision' && operation.input?.mode==='remove')}<div class="grid gap-2 sm:grid-cols-3"><Input value={approvalEdit(operation).title} oninput={(event)=>setApprovalEdit(operation,'title',event.currentTarget.value)} placeholder="Record title" /><Input type="date" value={approvalEdit(operation).date} oninput={(event)=>setApprovalEdit(operation,'date',event.currentTarget.value)} /><Input value={approvalEdit(operation).category} oninput={(event)=>setApprovalEdit(operation,'category',event.currentTarget.value)} placeholder="Category" /></div><textarea class="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={approvalEdit(operation).content} oninput={(event)=>setApprovalEdit(operation,'content',event.currentTarget.value)} placeholder="Record content"></textarea>{/if}
								<div class="mt-3 flex flex-wrap justify-end gap-2">{#if operation.type==='profile_record_revision'}<Button size="sm" variant="outline" onclick={()=>postApprovalAction(request,operation,'restore')} disabled={busy}>Restore previous</Button>{/if}{#if !(operation.type==='profile_record_revision' && operation.input?.mode==='remove')}<Button size="sm" variant="outline" onclick={()=>postApprovalAction(request,operation,'remove')} disabled={busy}>Remove</Button><Button size="sm" onclick={()=>postApprovalAction(request,operation,'change')} disabled={busy}>Revise</Button>{/if}</div></div>
							{/if}

							{#if expandedRequestId === request.id}<div class="mt-3 grid gap-3 lg:grid-cols-2"><div class="min-w-0 rounded-md border p-3"><p class="mb-2 text-xs font-semibold uppercase text-muted-foreground">Before</p><pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{pretty(operation.before)}</pre></div><div class="min-w-0 rounded-md border p-3"><p class="mb-2 text-xs font-semibold uppercase text-muted-foreground">After / proposed write</p><pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{pretty(operation.after)}</pre></div></div>{/if}
						</div>
					{/each}</div>

					{#if data.canManage && ['pending','needs_target'].includes(request.status)}<div class="mt-4 rounded-lg border p-3"><label class="text-sm font-medium" for={`review-note-${request.id}`}>Review reason / note</label><textarea id={`review-note-${request.id}`} class="mt-2 min-h-20 w-full rounded-md border bg-background p-3 text-sm" value={approvalNotes[request.id] || ''} oninput={(event)=>approvalNotes={...approvalNotes,[request.id]:event.currentTarget.value}} placeholder="Reason required for Deny. Optional note for Approve."></textarea><div class="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onclick={() => decideApproval(request,false)} disabled={busy}>Deny</Button><Button onclick={() => decideApproval(request,true)} disabled={busy || request.status==='needs_target'}>Approve</Button></div>{#if request.status==='needs_target'}<p class="mt-2 text-xs text-muted-foreground">Approve is disabled until every operation has a valid destination. Deny is always available and returns the request to the author.</p>{/if}</div>{/if}
					{#if expandedRequestId === request.id && request.audit?.length}<div class="mt-4 rounded-lg border p-3"><p class="text-sm font-medium">Review activity</p><div class="mt-2 space-y-2">{#each request.audit.slice().reverse() as event}<div class="rounded-md bg-muted/40 p-2 text-xs"><div class="flex flex-wrap items-center justify-between gap-2"><strong>{String(event.action || 'activity').replaceAll('_',' ')}</strong><span class="text-muted-foreground">{event.at ? new Date(event.at).toLocaleString() : ''}</span></div><p class="mt-1 text-muted-foreground">{event.actor || 'system'}{event.note ? ` · ${event.note}` : ''}{event.fields?.length ? ` · fields: ${event.fields.join(', ')}` : ''}</p></div>{/each}</div></div>{/if}
					{#if request.reviewedBy}<p class="mt-3 text-xs text-muted-foreground">Reviewed by {request.reviewedBy}{request.reviewedAt ? ` · ${new Date(request.reviewedAt).toLocaleString()}` : ''}{request.appliedAt ? ` · applied ${new Date(request.appliedAt).toLocaleString()}` : ''}</p>{/if}
				</article>
			{/each}
		</CardContent></Card>
	{/if}

	{#if data && activeTab === 'records'}
		<Card><CardHeader><CardTitle>Structured records</CardTitle></CardHeader><CardContent class="space-y-3">
			<div><Input bind:value={recordQuery} placeholder="Search records, people, date, place or source…" /><p class="mt-1 text-xs text-muted-foreground">Records include indexed dated records, incidents and approved Profile Records. Profile Records stay linked to their exact profile/section and approval history.</p></div>
			{#if filteredRecords.length === 0}<p class="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No structured records yet. Rebuild a dated log or register one as Knowledge.</p>{/if}
			<div class="space-y-3">{#each filteredRecords as record (record.id)}
				<article class="rounded-lg border p-4">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div class="text-xs font-semibold text-primary">{record.date}</div><div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold">{record.title}</h3>{#if record.state && record.state!=='active'}<span class="rounded border px-1.5 py-0.5 text-[11px]">{record.state}</span>{/if}{#if record.revision && record.revision>1}<span class="rounded border px-1.5 py-0.5 text-[11px]">rev {record.revision}</span>{/if}</div><p class="text-xs text-muted-foreground">{record.type === 'incident' ? 'Incident' : record.origin==='approval_profile_record' ? 'Profile record' : 'Dated record'} · {record.profileName || itemName(record.itemId)}{record.origin==='approval_profile_record' ? ` → ${record.sectionId || 'records'}` : ''}</p></div><Button size="sm" variant="outline" onclick={()=>openRecordSource(record)}>Open source</Button></div>
					{#if record.people?.length}<div class="mt-3 flex flex-wrap gap-1.5">{#each record.people as person}<span class="rounded-full border px-2 py-1 text-xs">{person.name}</span>{/each}</div>{/if}
					{#if record.location}<p class="mt-3 text-sm"><span class="font-medium">Location:</span> {record.location}</p>{/if}
					{#if record.summary}<p class="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.summary}</p>{/if}
					{#if record.witnesses}<p class="mt-2 text-xs text-muted-foreground"><span class="font-medium text-foreground">Witnesses:</span> {record.witnesses}</p>{/if}
				</article>
			{/each}</div>
		</CardContent></Card>
	{/if}

	{#if data && activeTab === 'ccs'}
		{#key loadedWorkspaceId}<ContextLibraryPanel workspaceIdOverride={loadedWorkspaceId} hideWorkspacePicker={true} />{/key}
	{/if}

	{#if data && activeTab === 'profiles'}
		<div class="rounded-xl border bg-card p-1">
			<div class="border-b px-4 py-3"><h2 class="font-semibold">Profiles</h2><p class="text-sm text-muted-foreground">The existing Base Profile System. CCS can attach accessible profiles directly when you want them loaded as context.</p></div>
			<ProfileManager />
		</div>
	{/if}

	{#if data && activeTab === 'sections'}
		<div class="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
			<Card><CardHeader><CardTitle>Addressable sections</CardTitle></CardHeader><CardContent class="space-y-3">
				<div class="grid gap-2 md:grid-cols-[14rem_minmax(0,1fr)]"><select class="rounded-md border bg-background p-2 text-sm" bind:value={sectionItemId}><option value="">All knowledge</option>{#each data.items as item}<option value={item.id}>{item.name}</option>{/each}</select><Input bind:value={sectionQuery} placeholder="Find a section, incident, chapter or topic" /></div>
				{#if data.canManage}<div class="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onclick={indexEverything} disabled={busy}><RefreshCw class="size-4" />Refresh all indexes</Button></div>{/if}
				{#if filteredSections.length === 0}<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No indexed sections match. Index a Knowledge Item to build addressable sections.</p>{/if}
				<div class="max-h-[65vh] space-y-2 overflow-y-auto">{#each filteredSections as section}<div class="rounded-lg border p-3" style={`margin-left:${Math.min(4, Math.max(0, section.level - 1)) * 10}px`}><div class="flex items-start justify-between gap-3"><button class="min-w-0 flex-1 text-left" onclick={() => openSection(section)}><div class="flex flex-wrap items-center gap-2"><strong>{section.title}</strong><span class="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">L{section.level}</span></div><p class="mt-1 text-xs text-muted-foreground">{itemName(section.itemId)} · lines {section.lineStart}-{section.lineEnd} · {section.wordCount || 0} words</p>{#if section.preview}<p class="mt-2 line-clamp-2 text-sm text-muted-foreground">{section.preview}</p>{/if}</button></div></div>{/each}</div>
			</CardContent></Card>
			<Card><CardHeader><CardTitle>Section content</CardTitle></CardHeader><CardContent>{#if !selectedSectionId}<p class="text-sm text-muted-foreground">Open a section to resolve its current content directly from the canonical source.</p>{:else}<div class="max-h-[70vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-relaxed">{selectedSectionContent || 'Loading…'}</div>{/if}</CardContent></Card>
		</div>
	{/if}

	{#if data && activeTab === 'timeline'}
		<div class="grid gap-4 xl:grid-cols-[minmax(20rem,0.75fr)_minmax(0,1.25fr)]">
			{#if data.canManage}<Card><CardHeader><CardTitle>Add timeline event</CardTitle></CardHeader><CardContent class="space-y-3"><select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={eventItemId} onchange={() => (eventSectionId = '')}><option value="">Knowledge item</option>{#each data.items as item}<option value={item.id}>{item.name}</option>{/each}</select><select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={eventSectionId} disabled={!eventItemId}><option value="">Whole item / no section</option>{#each data.sections.filter((section) => section.itemId === eventItemId) as section}<option value={section.id}>{section.title}</option>{/each}</select><Input type="date" bind:value={eventDate} /><Input bind:value={eventTitle} placeholder="Event title" /><textarea class="min-h-24 w-full rounded-md border bg-background p-2 text-sm" bind:value={eventDescription} placeholder="Event summary"></textarea><Button class="w-full" onclick={createTimelineEvent} disabled={busy || !eventItemId || !eventDate || !eventTitle.trim()}><Plus class="size-4" />Add event</Button></CardContent></Card>{/if}
			<Card><CardHeader><CardTitle>Knowledge timeline</CardTitle></CardHeader><CardContent class="space-y-2">{#if data.events.filter((event) => event.status !== 'dismissed').length === 0}<p class="text-sm text-muted-foreground">No events yet. Index dated source sections or add an event manually.</p>{/if}{#each data.events.filter((event) => event.status !== 'dismissed').slice().sort((a,b) => String(a.date).localeCompare(String(b.date))) as event}<div class="rounded-lg border p-3"><div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong>{event.date} · {event.title}</strong><span class="rounded border px-1.5 py-0.5 text-[10px]">{event.origin}</span><span class="rounded border px-1.5 py-0.5 text-[10px]">{event.status}</span></div><p class="mt-1 text-xs text-muted-foreground">{itemName(event.itemId)}{event.sectionId ? ` · ${data.sections.find((section) => section.id === event.sectionId)?.title || 'section'}` : ''}</p>{#if event.description}<p class="mt-2 text-sm text-muted-foreground">{event.description}</p>{/if}</div>{#if data.canManage && event.origin === 'indexer'}<div class="flex gap-1">{#if event.status !== 'confirmed'}<Button size="sm" variant="outline" onclick={() => setEventStatus(event, 'confirmed')}>Confirm</Button>{/if}<Button size="sm" variant="ghost" onclick={() => setEventStatus(event, 'dismissed')}>Dismiss</Button></div>{/if}</div></div>{/each}</CardContent></Card>
		</div>
	{/if}

	{#if data && activeTab === 'retrieve'}
		<div class="grid gap-4 xl:grid-cols-[minmax(20rem,0.7fr)_minmax(0,1.3fr)]">
			<Card><CardHeader><CardTitle>Targeted knowledge retrieval</CardTitle></CardHeader><CardContent class="space-y-3"><p class="text-sm text-muted-foreground">Resolve only the sections relevant to a task instead of loading entire source documents.</p><Input bind:value={retrievalQuery} placeholder="What context do you need?" /><div class="grid grid-cols-2 gap-2"><label class="space-y-1 text-xs"><span>Character budget</span><Input type="number" min="500" max="50000" bind:value={retrievalMaxChars} /></label><label class="space-y-1 text-xs"><span>Max sections</span><Input type="number" min="1" max="50" bind:value={retrievalLimit} /></label></div><Button class="w-full" onclick={retrieveKnowledge} disabled={retrievalBusy}>{#if retrievalBusy}<LoaderCircle class="size-4 animate-spin" />{:else}<Search class="size-4" />{/if}Retrieve</Button></CardContent></Card>
			<div class="space-y-3">{#if retrievalResults.length === 0}<Card><CardContent class="p-5 text-sm text-muted-foreground">Run a retrieval to see the exact canonical sections a knowledge consumer would receive.</CardContent></Card>{/if}{#each retrievalResults as result}<Card><CardHeader><CardTitle class="text-base">{result.itemName} → {result.sectionTitle}</CardTitle><p class="text-xs text-muted-foreground">score {result.score} · lines {result.lineStart}-{result.lineEnd}{result.truncated ? ' · truncated to budget' : ''}</p></CardHeader><CardContent class="space-y-2">{#if result.importance !== undefined}<p class="text-xs text-muted-foreground">Importance {Math.round(Number(result.importance || 0) * 100)}%{result.entities?.length ? ' · Entities: ' + result.entities.map((entity:any) => entity.name).join(', ') : ''}{result.facts?.length ? ' · ' + result.facts.length + ' fact candidates' : ''}</p>{/if}<div class="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm leading-relaxed">{result.content}</div></CardContent></Card>{/each}</div>
		</div>
	{/if}
	{#if data && activeTab === 'intelligence'}
		<div class="space-y-4">
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
				<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Entities</p><p class="mt-1 text-2xl font-semibold">{data.stats?.entities || 0}</p></CardContent></Card>
				<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Entity mentions</p><p class="mt-1 text-2xl font-semibold">{data.stats?.entityMentions || 0}</p></CardContent></Card>
				<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Fact candidates</p><p class="mt-1 text-2xl font-semibold">{data.stats?.facts || 0}</p></CardContent></Card>
				<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Fact relations</p><p class="mt-1 text-2xl font-semibold">{data.stats?.factRelations || 0}</p></CardContent></Card>
				<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Possible contradictions</p><p class="mt-1 text-2xl font-semibold">{data.stats?.contradictions || 0}</p></CardContent></Card>
			</div>
			<div class="grid gap-4 xl:grid-cols-[minmax(18rem,0.65fr)_minmax(0,1.35fr)]">
				<Card><CardHeader><CardTitle>Detected entities</CardTitle></CardHeader><CardContent class="space-y-2">
					<p class="text-sm text-muted-foreground">Permission-aware profile and Knowledge Item names recognised across indexed sections.</p>
					<div class="max-h-[60vh] space-y-2 overflow-y-auto">{#each data.entities as entity}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><strong>{entity.name}</strong><span class="text-[11px] text-muted-foreground">{entity.kind}</span></div>{#if entity.aliases?.length}<p class="mt-1 text-xs text-muted-foreground">Aliases: {entity.aliases.join(', ')}</p>{/if}<p class="mt-1 text-xs text-muted-foreground">{data.entityMentions.filter((mention) => mention.entityId === entity.id).reduce((sum, mention) => sum + mention.count, 0)} mentions</p></div>{/each}</div>
				</CardContent></Card>
				<div class="space-y-4">
					<Card><CardHeader><CardTitle>Fact candidates</CardTitle></CardHeader><CardContent class="space-y-3">
						<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]"><Input bind:value={intelligenceQuery} placeholder="Search extracted claims" /><select class="rounded-md border bg-background p-2 text-sm" bind:value={intelligenceStatus}><option value="all">All active</option><option value="candidate">Candidates</option><option value="confirmed">Confirmed</option></select></div>
						<p class="text-xs text-muted-foreground">These are extracted claims, not automatically accepted as true. Confirm or dismiss them when appropriate.</p>
						<div class="max-h-[55vh] space-y-2 overflow-y-auto">{#each filteredFacts.slice().sort((a,b) => Number(b.importance || 0) - Number(a.importance || 0)).slice(0,250) as fact}<div class="rounded-md border p-3"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1"><p class="text-sm">{fact.text}</p><p class="mt-1 text-[11px] text-muted-foreground">{itemName(fact.itemId)} · {data.sections.find((section) => section.id === fact.sectionId)?.title || 'section'}{fact.date ? ' · ' + fact.date : ''} · {Math.round(Number(fact.confidence || 0) * 100)}% confidence · {Math.round(Number(fact.importance || 0) * 100)}% importance</p>{#if fact.entityIds?.length}<p class="mt-1 text-[11px] text-muted-foreground">Entities: {fact.entityIds.map(entityName).join(', ')}</p>{/if}</div>{#if data.canManage}<div class="flex shrink-0 gap-1">{#if fact.status !== 'confirmed'}<Button size="sm" variant="outline" onclick={() => setFactStatus(fact, 'confirmed')}>Confirm</Button>{/if}<Button size="sm" variant="ghost" onclick={() => setFactStatus(fact, 'dismissed')}>Dismiss</Button></div>{/if}</div></div>{/each}</div>
					</CardContent></Card>
					<Card><CardHeader><CardTitle>Cross-source claim relationships</CardTitle></CardHeader><CardContent class="space-y-2">
						<p class="text-xs text-muted-foreground">Support, duplicate and contradiction matches are similarity candidates. A possible contradiction means two extracted claims differ; it does not decide which one is true.</p>
						{#if data.factRelations.filter((relation) => relation.status !== 'dismissed').length === 0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No cross-source fact relationships detected yet.</p>{/if}
						<div class="max-h-[45vh] space-y-2 overflow-y-auto">{#each data.factRelations.filter((relation) => relation.status !== 'dismissed').slice().sort((a,b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0,250) as relation}<div class="rounded-md border p-3"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap gap-2 text-xs"><span class="rounded border px-1.5 py-0.5 font-medium">{relation.relation === 'contradicts' ? 'possible contradiction' : relation.relation === 'supports' ? 'supporting claim' : relation.relation === 'duplicate_of' ? 'duplicate claim' : relation.relation}</span><span class="text-muted-foreground">{Math.round(Number(relation.confidence || 0) * 100)}% confidence · {relation.status}</span></div><p class="mt-2 text-sm">{factText(relation.sourceFactId)}</p><p class="my-1 text-center text-xs text-muted-foreground">↕</p><p class="text-sm">{factText(relation.targetFactId)}</p><p class="mt-1 text-[11px] text-muted-foreground">{itemName(relation.sourceItemId)} ↔ {itemName(relation.targetItemId)}</p></div>{#if data.canManage}<div class="flex shrink-0 gap-1">{#if relation.status !== 'confirmed'}<Button size="sm" variant="outline" onclick={() => setFactRelationStatus(relation, 'confirmed')}>Confirm</Button>{/if}<Button size="sm" variant="ghost" onclick={() => setFactRelationStatus(relation, 'dismissed')}>Dismiss</Button></div>{/if}</div></div>{/each}</div>
					</CardContent></Card>
				</div>
			</div>
		</div>
	{/if}

	{#if data && activeTab === 'lineage'}
		<div class="grid gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
			<Card><CardHeader><CardTitle>Version & source lineage</CardTitle></CardHeader><CardContent class="space-y-3">
				<select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={lineageItemId} onchange={() => { lineageData = null; impactData = null; }}><option value="">Choose Knowledge Item</option>{#each data.items as item}<option value={item.id}>{item.name}{item.versionLabel ? ` · ${item.versionLabel}` : ''}</option>{/each}</select>
				<Button class="w-full" variant="outline" onclick={() => loadLineage()} disabled={!lineageItemId || lineageBusy}>{#if lineageBusy}<LoaderCircle class="size-4 animate-spin" />{:else}<Network class="size-4" />{/if}Load lineage & impact</Button>
				{#if data.canManage && lineageItemId}<div class="space-y-2 rounded-md border p-3"><p class="text-sm font-medium">Add lineage relationship</p><select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={lineageRelation}><option value="supersedes">Supersedes / newer version of</option><option value="derived_from">Derived from</option></select>{#if lineageRelation === 'supersedes'}<Input bind:value={lineageVersionLabel} placeholder="Version label for current item" />{/if}<select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={lineageTargetId}><option value="">Choose older/source item</option>{#each data.items.filter((item) => item.id !== lineageItemId) as item}<option value={item.id}>{item.name}{item.versionLabel ? ` · ${item.versionLabel}` : ''}</option>{/each}</select><Button class="w-full" onclick={addLineage} disabled={lineageBusy || !lineageTargetId}><Link2 class="size-4" />Link lineage</Button></div>{/if}
			</CardContent></Card>
			<div class="space-y-4">
				<Card><CardHeader><CardTitle>Resolved lineage</CardTitle></CardHeader><CardContent class="space-y-3">{#if !lineageData}<p class="text-sm text-muted-foreground">Choose an item to resolve its complete visible version chain and derivatives.</p>{:else}<div class="flex flex-wrap gap-2">{#each lineageData.nodes || [] as node}<span class="rounded-md border px-2 py-1 text-sm" class:bg-accent={(lineageData.current || []).some((current:any) => current.id === node.id)}>{node.name}{node.versionLabel ? ` · ${node.versionLabel}` : ''} · {node.status}</span>{/each}</div><div class="grid gap-2 sm:grid-cols-2"><div class="rounded-md border p-3"><p class="text-xs font-medium uppercase text-muted-foreground">Current</p>{#each lineageData.current || [] as node}<p class="mt-1 text-sm">{node.name}{node.versionLabel ? ` · ${node.versionLabel}` : ''}</p>{/each}</div><div class="rounded-md border p-3"><p class="text-xs font-medium uppercase text-muted-foreground">Original/root</p>{#each lineageData.roots || [] as node}<p class="mt-1 text-sm">{node.name}{node.versionLabel ? ` · ${node.versionLabel}` : ''}</p>{/each}</div></div>{#if lineageData.derivedFrom?.length}<div><p class="text-sm font-medium">Derived from</p>{#each lineageData.derivedFrom as node}<p class="text-sm text-muted-foreground">{node.name}</p>{/each}</div>{/if}{#if lineageData.derivatives?.length}<div><p class="text-sm font-medium">Derivatives</p>{#each lineageData.derivatives as node}<p class="text-sm text-muted-foreground">{node.name}</p>{/each}</div>{/if}{/if}</CardContent></Card>
				<Card><CardHeader><CardTitle>Change impact</CardTitle></CardHeader><CardContent class="space-y-3">{#if !impactData}<p class="text-sm text-muted-foreground">Impact shows visible systems that depend on this Knowledge Item before you replace, archive or remove it.</p>{:else}<div class="grid grid-cols-2 gap-2 text-center text-xs"><div class="rounded bg-muted p-2"><strong class="block text-lg">{impactData.usage?.length || 0}</strong>consumers</div><div class="rounded bg-muted p-2"><strong class="block text-lg">{impactData.linkedItems?.length || 0}</strong>linked items</div></div>{#if impactData.usage?.length}<div><p class="text-sm font-medium">Addon/runtime consumers</p>{#each impactData.usage as entry}<p class="text-sm text-muted-foreground">{entry.consumerType} · {entry.consumerName}</p>{/each}</div>{/if}{#if impactData.linkedItems?.length}<div><p class="text-sm font-medium">Connected knowledge</p>{#each impactData.linkedItems as entry}<p class="text-sm text-muted-foreground">{entry.name}{entry.versionLabel ? ` · ${entry.versionLabel}` : ''}</p>{/each}</div>{/if}<p class="text-xs text-muted-foreground">{impactData.sectionCount || 0} sections · {impactData.factCount || 0} fact candidates · {impactData.timelineEvents || 0} timeline events</p>{/if}</CardContent></Card>
			</div>
		</div>
	{/if}

	{#if data && activeTab === 'links'}
		<div class="grid gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
			{#if data.canManage}<Card><CardHeader><CardTitle>Link knowledge</CardTitle></CardHeader><CardContent class="space-y-3">
				<select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={linkSourceId}><option value="">Source item</option>{#each data.items as item}<option value={item.id}>{item.name}</option>{/each}</select>
				<Input bind:value={linkRelation} placeholder="Relationship, e.g. references" />
				<select class="w-full rounded-md border bg-background p-2 text-sm" bind:value={linkTargetId}><option value="">Target item</option>{#each data.items.filter((item) => item.id !== linkSourceId) as item}<option value={item.id}>{item.name}</option>{/each}</select>
				<Button class="w-full" onclick={createLink} disabled={busy || !linkSourceId || !linkTargetId}><Link2 class="size-4" />Create link</Button>
			</CardContent></Card>{/if}
						<div class="space-y-4">
			<Card><CardHeader><CardTitle>Suggested automatic links</CardTitle></CardHeader><CardContent class="space-y-2"><p class="text-sm text-muted-foreground">Indexer-detected relationships stay as candidates until you confirm or dismiss them.</p>{#if data.autoLinks.filter((link) => link.status !== 'dismissed').length === 0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No automatic link candidates yet.</p>{/if}{#each data.autoLinks.filter((link) => link.status !== 'dismissed') as link}<div class="rounded-md border p-3 text-sm"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p><strong>{itemName(link.sourceItemId)}</strong>{#if link.sourceSectionId}<span class="text-muted-foreground"> → {data.sections.find((section) => section.id === link.sourceSectionId)?.title || 'section'}</span>{/if} <span class="text-muted-foreground">{link.relation}</span> <strong>{itemName(link.targetItemId)}</strong></p>{#if link.evidence}<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{link.evidence}</p>{/if}<p class="mt-1 text-[11px] text-muted-foreground">{link.status || 'candidate'}{link.confidence ? ` · ${Math.round(link.confidence * 100)}% confidence` : ''}</p></div>{#if data.canManage}<div class="flex shrink-0 gap-1">{#if link.status !== 'confirmed'}<Button size="sm" variant="outline" onclick={() => setAutoLinkStatus(link, 'confirmed')}>Confirm</Button>{/if}<Button size="sm" variant="ghost" onclick={() => setAutoLinkStatus(link, 'dismissed')}>Dismiss</Button></div>{/if}</div></div>{/each}</CardContent></Card>
			<Card><CardHeader><CardTitle>Knowledge graph links</CardTitle></CardHeader><CardContent class="space-y-2">
				{#if data.links.length === 0}<p class="text-sm text-muted-foreground">No explicit links yet.</p>{/if}
				{#each data.links as link}<div class="flex items-center gap-3 rounded-md border p-3 text-sm"><div class="min-w-0 flex-1 break-words"><strong>{itemName(link.sourceItemId)}</strong> <span class="text-muted-foreground">{link.relation}</span> <strong>{itemName(link.targetItemId)}</strong></div>{#if data.canManage}<Button size="icon" variant="ghost" onclick={() => removeLink(link)}><Trash2 class="size-4" /></Button>{/if}</div>{/each}
			</CardContent></Card>
			</div>
		</div>
	{/if}

	{#if data && activeTab === 'usage'}
		<Card><CardHeader><CardTitle>Where knowledge is used</CardTitle></CardHeader><CardContent class="space-y-3">
			<p class="text-sm text-muted-foreground">Knowledge links and runtime consumers are tracked here permission-aware. MCP/CCS can consume these mappings later; Library itself remains the canonical knowledge system.</p>
			{#each data.items as item}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-3"><strong class="break-words">{item.name}</strong><span class="text-xs text-muted-foreground">{(item.linkCount || 0) + (item.usageCount || 0)} uses</span></div><div class="mt-2 space-y-1 text-xs text-muted-foreground">
				{#each data.links.filter((link) => link.sourceItemId === item.id || link.targetItemId === item.id) as link}<div>Knowledge link · {itemName(link.sourceItemId)} {link.relation} {itemName(link.targetItemId)}</div>{/each}
				{#each data.usage.filter((entry) => entry.itemId === item.id) as entry}<div>{entry.consumerType} · {entry.consumerName || entry.consumerId}</div>{/each}
				{#if !(item.linkCount || item.usageCount)}<div>No consumers yet.</div>{/if}
			</div></div>{/each}
		</CardContent></Card>
	{/if}
</div>
