"use client";

import Link from "next/link";
import {use,useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import {newsCategoryLabel} from "@/lib/news";
import styles from "../news.module.css";

function displayDate(value?:string|null){return value?new Date(value).toLocaleDateString("en-AU",{day:"numeric",month:"long",year:"numeric"}):""}

function Body({text}:{text:string}){
  const lines=String(text||"").split(/\r?\n/),out:any[]=[];let bullets:string[]=[];
  const flush=()=>{if(bullets.length){out.push(<ul key={`ul-${out.length}`}>{bullets.map((x,i)=><li key={i}>{x}</li>)}</ul>);bullets=[]}};
  lines.forEach((raw,i)=>{const line=raw.trim();if(line.startsWith("- ")){bullets.push(line.slice(2));return}flush();if(!line)return;if(line.startsWith("## "))out.push(<h2 key={i}>{line.slice(3)}</h2>);else if(line.startsWith("### "))out.push(<h3 key={i}>{line.slice(4)}</h3>);else if(line.startsWith("> "))out.push(<p className={styles.quote} key={i}>{line.slice(2)}</p>);else out.push(<p key={i}>{line}</p>)});flush();return <>{out}</>;
}

export default function NewsArticle({params}:{params:Promise<{slug:string}>}){
  const {slug}=use(params),sb=createClient();
  const [post,setPost]=useState<any>(undefined),[related,setRelated]=useState<any[]>([]);
  useEffect(()=>{(async()=>{const {data}=await sb.from("news_posts").select("slug,title,excerpt,body,category,published_at,author_name,cta_label,cta_url,featured,pinned").eq("slug",slug).eq("published",true).maybeSingle();setPost(data||null);if(data){const {data:r}=await sb.from("news_posts").select("slug,title,category,published_at").eq("published",true).eq("category",data.category).neq("slug",slug).order("published_at",{ascending:false}).limit(2);setRelated(r||[])}})()},[slug]);

  if(post===undefined)return <main className={styles.page}><header className={styles.header}><Link className={styles.brand} href="/"><i className={styles.brandMark}/><strong>OrbitFS</strong><span>News</span></Link></header><div className={styles.articleWrap}>Loading news…</div></main>;
  if(!post)return <main className={styles.page}><header className={styles.header}><Link className={styles.brand} href="/"><i className={styles.brandMark}/><strong>OrbitFS</strong><span>News</span></Link></header><div className={styles.articleWrap}><Link className={styles.articleBack} href="/news">← Back to News</Link><section className={styles.articleHero}><p className={styles.kicker}>OrbitFS News</p><h1>News post not found.</h1><p className={styles.articleExcerpt}>This update is unavailable, unpublished or no longer active.</p></section></div></main>;

  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/"><i className={styles.brandMark}/><strong>OrbitFS</strong><span>News</span></Link><nav className={styles.nav}><Link href="/news">All News</Link><Link href="/support">Support</Link><Link className={styles.navCta} href="/portal">Customer Portal</Link></nav></header>
    <div className={styles.articleWrap}>
      <Link className={styles.articleBack} href="/news">← Back to all news</Link>
      <section className={styles.articleHero}><div className={styles.meta}><span className={styles.badge}>{newsCategoryLabel(post.category)}</span>{post.pinned&&<span>Pinned</span>}{post.featured&&<span>Featured</span>}</div><h1>{post.title}</h1>{post.excerpt&&<p className={styles.articleExcerpt}>{post.excerpt}</p>}<div className={styles.articleMeta}><span>{displayDate(post.published_at)}</span>{post.author_name&&<span>By {post.author_name}</span>}<span>OrbitFS</span></div></section>
      <article className={styles.articleBody}><Body text={post.body||post.excerpt||""}/></article>
      {post.cta_label&&post.cta_url&&<aside className={styles.articleCta}><p>Continue from this update.</p><a href={post.cta_url}>{post.cta_label}</a></aside>}
      {related.length>0&&<><div className={styles.relatedTitle}>More {newsCategoryLabel(post.category)}</div><div className={styles.relatedGrid}>{related.map(r=><Link className={styles.relatedCard} href={`/news/${r.slug}`} key={r.slug}><span>{displayDate(r.published_at)}</span><h3>{r.title}</h3></Link>)}</div></>}
    </div>
    <footer className={styles.footer}><span>© OrbitFS</span><nav><Link href="/news">News</Link><Link href="/support">Support</Link><Link href="/portal">Customer Portal</Link></nav></footer>
  </main>
}
