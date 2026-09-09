export const NEWS_CATEGORIES=[
  {value:"product_updates",label:"Product News and Updates",shortLabel:"Product Updates",description:"OrbitFS releases, product changes, add-ons and development updates."},
  {value:"announcements",label:"Announcements",shortLabel:"Announcements",description:"Important OrbitFS notices, launches and business announcements."},
  {value:"general_news",label:"General News",shortLabel:"General News",description:"General OrbitFS news, stories and information."}
] as const;

export type NewsCategory=(typeof NEWS_CATEGORIES)[number]["value"];

export function newsCategory(value?:string|null){
  return NEWS_CATEGORIES.find(x=>x.value===value)||NEWS_CATEGORIES[2];
}

export function newsCategoryLabel(value?:string|null){return newsCategory(value).label}

export function slugifyNews(value:string){
  return String(value||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90);
}

export function newsPublishState(post:any,now=new Date()){
  if(!post?.published)return "draft";
  const publishAt=post.published_at?new Date(post.published_at):null;
  const unpublishAt=post.unpublish_at?new Date(post.unpublish_at):null;
  if(publishAt&&publishAt.getTime()>now.getTime())return "scheduled";
  if(unpublishAt&&unpublishAt.getTime()<=now.getTime())return "expired";
  return "published";
}

export function newsPublishStateLabel(post:any){
  const state=newsPublishState(post);
  return state==="scheduled"?"Scheduled":state==="expired"?"Expired":state==="published"?"Published":"Draft";
}
