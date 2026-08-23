import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ALL_TAGS } from "../../api/posts";
import { postsQueryOptions, useCreatePost, useDeletePost } from "../../queries/posts";

const postsSearchSchema = z.object({
  q: z.string().optional().catch("").default(""),
  tag: z.enum(ALL_TAGS).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(1).default(1),
});

const PAGE_SIZE = 3;

export const Route = createFileRoute("/posts/")({
  validateSearch: postsSearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, tag: search.tag, page: search.page }),
  loader: ({ context: { queryClient }, deps }) =>
    // Populates the Query cache before render; a second navigation to the
    // same filters reuses the cache instead of re-fetching.
    queryClient.ensureQueryData(postsQueryOptions({ q: deps.q, tag: deps.tag })),
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

function NewPostForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState<(typeof ALL_TAGS)[number]>("note");
  const createPost = useCreatePost();

  return (
    <form
      className="new-post"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        createPost.mutate(
          { title, body, tag },
          {
            onSuccess: () => {
              setTitle("");
              setBody("");
            },
          },
        );
      }}
    >
      <input
        placeholder="Title (contains 'fail' to test rollback)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
      <select value={tag} onChange={(e) => setTag(e.target.value as typeof tag)}>
        {ALL_TAGS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="submit" disabled={createPost.isPending || !title.trim()}>
        {createPost.isPending ? "Adding…" : "Add post"}
      </button>
      {createPost.isError && (
        <p className="error">Couldn't add post: {createPost.error.message}</p>
      )}
    </form>
  );
}

function PostsComponent() {
  const { q, tag, page } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: posts, isFetching, dataUpdatedAt } = useSuspenseQuery(
    postsQueryOptions({ q, tag }),
  );
  const deletePost = useDeletePost();

  const start = (page - 1) * PAGE_SIZE;
  const pageItems = posts.slice(start, start + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const isStale = Date.now() - dataUpdatedAt > 30_000;

  return (
    <div className="page">
      <h1>
        Posts {isFetching && <span className="muted refresh-indicator">refreshing…</span>}
      </h1>
      {isStale && !isFetching && (
        <p className="muted stale-note">Showing cached results — they may be out of date.</p>
      )}

      <NewPostForm />

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
              <Link to="/posts/$postId" params={{ postId: post.id }} preload="intent">
                {post.title}
              </Link>{" "}
              <span className="tag">{post.tag}</span>{" "}
              <button
                className="delete-btn"
                onClick={() => deletePost.mutate(post.id)}
                disabled={deletePost.isPending}
              >
                Delete
              </button>
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
