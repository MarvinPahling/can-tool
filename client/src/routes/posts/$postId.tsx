import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ALL_TAGS } from "../../api/posts";
import { postQueryOptions, useDeletePost, useUpdatePost } from "../../queries/posts";

export const Route = createFileRoute("/posts/$postId")({
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.ensureQueryData(postQueryOptions(params.postId));
    } catch {
      throw notFound();
    }
  },
  pendingComponent: PostPending,
  errorComponent: PostError,
  notFoundComponent: () => (
    <div className="page">
      <h1>Post not found</h1>
      <Link to="/posts">Back to posts</Link>
    </div>
  ),
  component: PostComponent,
});

function PostPending() {
  return (
    <div className="page">
      <p className="muted">Loading post…</p>
    </div>
  );
}

function PostError({ error }: { error: Error }) {
  return (
    <div className="page">
      <p className="error">Couldn't load this post: {error.message}</p>
      <Link to="/posts">Back to posts</Link>
    </div>
  );
}

function PostComponent() {
  const { postId } = Route.useParams();
  const navigate = useNavigate();
  const { data: post, isFetching } = useSuspenseQuery(postQueryOptions(postId));
  const updatePost = useUpdatePost();
  const deletePost = useDeletePost();

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [tag, setTag] = useState(post.tag);

  return (
    <div className="page">
      <Link to="/posts">← Back to posts</Link>
      {isFetching && <span className="muted refresh-indicator"> refreshing…</span>}

      {isEditing ? (
        <form
          className="new-post"
          onSubmit={(e) => {
            e.preventDefault();
            updatePost.mutate(
              { id: postId, title, body, tag },
              { onSuccess: () => setIsEditing(false) },
            );
          }}
        >
          <input
            placeholder="Title (contains 'fail' to test rollback)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input value={body} onChange={(e) => setBody(e.target.value)} />
          <select value={tag} onChange={(e) => setTag(e.target.value as typeof tag)}>
            {ALL_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="submit" disabled={updatePost.isPending}>
            {updatePost.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setIsEditing(false)}>
            Cancel
          </button>
          {updatePost.isError && (
            <p className="error">Couldn't save: {updatePost.error.message}</p>
          )}
        </form>
      ) : (
        <>
          <h1>{post.title}</h1>
          <span className="tag">{post.tag}</span>
          <p>{post.body}</p>
          <div className="pager">
            <button onClick={() => setIsEditing(true)}>Edit</button>
            <button
              className="delete-btn"
              disabled={deletePost.isPending}
              onClick={() =>
                deletePost.mutate(postId, {
                  onSuccess: () => navigate({ to: "/posts" }),
                })
              }
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
