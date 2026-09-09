"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {NEWS_CATEGORIES,newsCategoryLabel} from "@/lib/news";
import styles from "./news.module.css";

type Post={slug:string;title:string;excerpt:string|null;category:string;pinned:boolean;featured:boolean;published_at:string|null;author_name:string|null};

function date(value?:string|null){return value?new Date(value).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}):""}

export default function NewsPage(){
  const sb=createClient();
  const [rows,setRows]=useState<Post[]>([]),[category,setCategory]=useState("all"),[loading,setLoading]=useState(true);
  useEffect(()=>{sb.from("news_posts").select("slug,title,excerpt,category,pinned,featured,published_at,author_name").eq("published",true).order("pinned",{ascending:false}).order("featured",{ascending:false}).order("published_at",{ascending:false}).then(({data})=>{setRows((data||[]) as Post[]);setLoading(false)})},[]);
  const filtered=useMemo(()=>category==="all"?rows:rows.filter(x=>x.category===category),[rows,category]);
  const featured=filtered.find(x=>x.featured)||filtered.find(x=>x.pinned)||filtered[0];
  const cards=featured?filtered.filter(x=>x.slug!==featured.slug):filtered;

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/"><i className={styles.brandMark}/><strong>OrbitFS</strong><span>News</span></Link>
      <nav className={styles.nav}><Link href="/">OrbitFS</Link><Link href="/support">Support</Link><Link className={styles.navCta} href="/portal">Customer Portal</Link></nav>
    </header>

    <section className={styles.hero}>
      <div><p className={styles.kicker}>OrbitFS Newsroom</p><h1>News, releases and <span>what’s changing.</span></h1><p className={styles.heroLead}>Product development, important announcements and general OrbitFS updates — all in one place.</p></div>
      <aside className={styles.heroAside}><b>Follow the system as it develops.</b><p>Product News and Updates covers new OrbitFS capabilities and development work. Announcements carries important notices, while General News keeps everything else organised.</p></aside>
    </section>

    <section className={styles.content}>
      <div className={styles.filters} aria-label="News categories">
        <button className={`${styles.filter} ${category==="all"?styles.filterActive:""}`} onClick={()=>setCategory("all")}>All news</button>
        {NEWS_CATEGORIES.map(x=><button key={x.value} className={`${styles.filter} ${category===x.value?styles.filterActive:""}`} onClick={()=>setCategory(x.value)}>{x.label}</button>)}
      </div>

      {loading?<div className={styles.empty}><h3>Loading OrbitFS news…</h3></div>:featured?<>
        <Link className={styles.featured} href={`/news/${featured.slug}`}>
          <div className={styles.featuredVisual}><span className={styles.featuredCode}>ORBITFS / {featured.category==="product_updates"?"PRODUCT":"NEWS"}</span><span className={styles.featuredGlyph}>↗</span></div>
          <div className={styles.featuredBody}><div className={styles.meta}><span className={styles.badge}>{newsCategoryLabel(featured.category)}</span>{featured.pinned&&<span>Pinned</span>}<span>{date(featured.published_at)}</span></div><h2>{featured.title}</h2><p>{featured.excerpt||"Read the full OrbitFS update."}</p><span className={styles.readMore}>Read full update →</span></div>
        </Link>
        <div className={styles.grid}>{cards.map(n=><Link className={styles.card} href={`/news/${n.slug}`} key={n.slug}><div className={styles.meta}><span className={styles.badge}>{newsCategoryLabel(n.category)}</span>{n.pinned&&<span>Pinned</span>}</div><h3>{n.title}</h3><p>{n.excerpt||"Read the full update."}</p><div className={styles.cardBottom}><span>{date(n.published_at)}{n.author_name?` · ${n.author_name}`:""}</span><b>Read →</b></div></Link>)}</div>
      </>:<div className={styles.grid}><article className={styles.empty}><h3>No published news in this category yet.</h3><p>New OrbitFS updates will appear here when they are published.</p></article></div>}
    </section>

    <footer className={styles.footer}><span>© OrbitFS</span><nav><Link href="/">OrbitFS</Link><Link href="/support">Support</Link><Link href="/portal">Customer Portal</Link></nav></footer>
  </main>
}
