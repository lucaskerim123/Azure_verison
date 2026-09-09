-- OrbitFS News v2
-- Adds controlled categories, richer publishing options, homepage/product-update controls,
-- article metadata and time-aware public visibility.

alter table public.news_posts
  add column if not exists featured boolean not null default false,
  add column if not exists show_on_homepage boolean not null default false,
  add column if not exists unpublish_at timestamptz null,
  add column if not exists author_name text null,
  add column if not exists cta_label text null,
  add column if not exists cta_url text null,
  add column if not exists seo_title text null,
  add column if not exists seo_description text null;

update public.news_posts
set category=case lower(trim(coalesce(category,'')))
  when 'product' then 'product_updates'
  when 'product_news' then 'product_updates'
  when 'product updates' then 'product_updates'
  when 'product news and updates' then 'product_updates'
  when 'announcement' then 'announcements'
  when 'announcements' then 'announcements'
  when 'general' then 'general_news'
  when 'general news' then 'general_news'
  when 'general_news' then 'general_news'
  when 'product_updates' then 'product_updates'
  else 'general_news'
end;

alter table public.news_posts drop constraint if exists news_posts_category_check;
alter table public.news_posts
  add constraint news_posts_category_check
  check (category in ('product_updates','announcements','general_news'));

create index if not exists news_posts_public_feed_idx
  on public.news_posts(published, published_at desc)
  where published=true;
create index if not exists news_posts_category_feed_idx
  on public.news_posts(category, published_at desc)
  where published=true;
create index if not exists news_posts_homepage_idx
  on public.news_posts(show_on_homepage, category, published_at desc)
  where published=true and show_on_homepage=true;

-- A future published_at is a scheduled post. An unpublish_at in the past hides it automatically.
drop policy if exists "published news readable" on public.news_posts;
create policy "published news readable"
on public.news_posts
for select
using (
  published=true
  and coalesce(published_at,created_at) <= now()
  and (unpublish_at is null or unpublish_at > now())
);
