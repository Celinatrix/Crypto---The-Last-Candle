"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNews } from "@/lib/api";
import { fmtCompact, timeAgo, toTime } from "@/lib/format";
import type { NewsPost } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const POLL_MS = 30_000;
const FRESH_MS = 6_000;

interface FeedState {
  channel: string | null;
  posts: NewsPost[] | null;
  error: string | null;
}

const safeHref = (url: string) => (/^https:\/\//i.test(url) ? url : undefined);

const byNewest = (a: NewsPost, b: NewsPost) => toTime(b.date) - toTime(a.date);

export default function NewsFeed() {
  const [feed, setFeed] = useState<FeedState>({ channel: null, posts: null, error: null });
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const seenRef = useRef<Set<string> | null>(null);
  const inFlightRef = useRef(false);
  const now = useNow();

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const data = await fetchNews();
      const posts = [...data.posts].sort(byNewest);
      const ids = posts.map((p) => String(p.id));

      // Highlight only posts that arrive after the first successful load.
      if (seenRef.current) {
        const seen = seenRef.current;
        const arrived = ids.filter((id) => !seen.has(id));
        if (arrived.length > 0) {
          setFresh(new Set(arrived));
          window.setTimeout(() => setFresh(new Set()), FRESH_MS);
        }
      }
      seenRef.current = new Set(ids);
      setFeed({ channel: data.channel || null, posts, error: data.error ?? null });
    } catch (err) {
      setFeed((f) => ({ ...f, posts: f.posts ?? [], error: err instanceof Error ? err.message : "Không tải được tin tức." }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => void load(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void load();
        start();
      }
    };

    void load();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const { channel, posts, error } = feed;

  return (
    <section className="news" aria-labelledby="news-title">
      <header className="news__head">
        <span className="live-dot" aria-hidden="true" />
        <h3 id="news-title" className="news__title">
          Tin tức cộng đồng
        </h3>
        {channel && (
          <a className="news__channel" href={`https://t.me/${channel}`} target="_blank" rel="noopener noreferrer">
            @{channel} ↗
          </a>
        )}
      </header>

      <div className="news__list" aria-busy={posts === null} aria-live="polite">
        {posts === null && <NewsSkeleton />}

        {posts !== null && posts.length === 0 && (
          <div className="news__empty">
            <p>{error ?? "Chưa có bài viết nào."}</p>
            {error && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()}>
                Thử lại
              </button>
            )}
          </div>
        )}

        {posts !== null && posts.length > 0 && (
          <ul className="news__posts">
            {posts.map((p) => (
              <PostCard key={String(p.id)} post={p} now={now} fresh={fresh.has(String(p.id))} />
            ))}
          </ul>
        )}

        {error && posts !== null && posts.length > 0 && <p className="news__stale">Đang hiển thị dữ liệu cũ · {error}</p>}
      </div>
    </section>
  );
}

function PostCard({ post, now, fresh }: { post: NewsPost; now: number; fresh: boolean }) {
  const t = toTime(post.date);
  const excerpt = post.text.replace(/\s+/g, " ").trim().slice(0, 90);
  return (
    <li className={`post${fresh ? " post--fresh" : ""}`}>
      <a className="post__link" href={safeHref(post.url)} target="_blank" rel="noopener noreferrer">
        {post.photo && (
          <img
            className="post__photo"
            src={post.photo}
            alt={excerpt ? `Ảnh đính kèm: ${excerpt}` : "Ảnh đính kèm bài viết"}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        )}
        {post.text && <p className="post__text">{post.text}</p>}
        <span className="post__meta">
          {Number.isFinite(t) && <time dateTime={new Date(t).toISOString()}>{timeAgo(t, now)}</time>}
          {post.views !== null && post.views !== undefined && (
            <span className="post__views num" aria-label={`${post.views} lượt xem`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {fmtCompact(post.views)}
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

function NewsSkeleton() {
  return (
    <ul className="news__posts" aria-label="Đang tải tin tức">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="post post--skeleton">
          {i === 1 && <span className="skeleton" style={{ height: 140 }} />}
          <span className="skeleton" style={{ height: 12, width: "92%" }} />
          <span className="skeleton" style={{ height: 12, width: "80%" }} />
          <span className="skeleton" style={{ height: 12, width: "55%" }} />
          <span className="skeleton" style={{ height: 10, width: 90, marginTop: 6 }} />
        </li>
      ))}
    </ul>
  );
}
