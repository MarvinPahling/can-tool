import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { fetchPost } from "../../api/posts";

export const Route = createFileRoute("/posts/$postId")({
  loader: async ({ params }) => {
    try {
      return await fetchPost(params.postId);
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
  const post = Route.useLoaderData();
  return (
    <div className="page">
      <Link to="/posts">← Back to posts</Link>
      <h1>{post.title}</h1>
      <span className="tag">{post.tag}</span>
      <p>{post.body}</p>
    </div>
  );
}
