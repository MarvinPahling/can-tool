import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ALL_TAGS, fetchPosts } from "../../api/posts";

const postsSearchSchema = z.object({
  q: z.string().optional().catch("").default(""),
  tag: z.enum(ALL_TAGS).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(1).default(1),
});

const PAGE_SIZE = 3;

export const Route = createFileRoute("/posts/")({
  validateSearch: postsSearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, tag: search.tag, page: search.page }),
  loader: async ({ deps }) => fetchPosts({ q: deps.q, tag: deps.tag }),
  pendingComponent: PostsPending,
  errorComponent: PostsError,
  component: PostsComponent,
});

function PostsPending() {
  return (
    <div className="page">
      <h1>Posts</h1>
      <p className="muted">Loading posts…</p>
    </div>
  );
}

function PostsError({ error }: { error: Error }) {
  return (
    <div className="page">
      <h1>Posts</h1>
      <p className="error">Couldn't load posts: {error.message}</p>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Keep the field in sync when the URL changes from elsewhere (back/forward,
  // a shared link, clearing filters), without fighting the user's typing.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const id = setTimeout(() => onChange(draft), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <input
      value={draft}
      placeholder="Search titles…"
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function PostsComponent() {
  const posts = Route.useLoaderData();
  const { q, tag, page } = Route.useSearch();
  const navigate = Route.useNavigate();

  const start = (page - 1) * PAGE_SIZE;
  const pageItems = posts.slice(start, start + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));

  return (
    <div className="page">
      <h1>Posts</h1>

      <div className="filters">
        <SearchInput
          value={q}
          onChange={(value) =>
            navigate({
              search: (prev) => ({ ...prev, q: value, page: 1 }),
              replace: true,
            })
          }
        />
        <select
          value={tag ?? ""}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                tag: e.target.value ? (e.target.value as (typeof ALL_TAGS)[number]) : undefined,
                page: 1,
              }),
            })
          }
        >
          <option value="">All tags</option>
          {ALL_TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {pageItems.length === 0 ? (
        <p className="muted">No posts match your filters.</p>
      ) : (
        <ul className="post-list">
          {pageItems.map((post) => (
            <li key={post.id}>
              <Link
                to="/posts/$postId"
                params={{ postId: post.id }}
                preload="intent"
              >
                {post.title}
              </Link>{" "}
              <span className="tag">{post.tag}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="pager">
        <button
          disabled={page <= 1}
          onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}
        >
          Previous
        </button>
        <span>
          Page {page} of {pageCount}
        </span>
        <button
          disabled={page >= pageCount}
          onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
        >
          Next
        </button>
      </div>
    </div>
  );
}
