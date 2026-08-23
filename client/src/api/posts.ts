export interface Post {
  id: string;
  title: string;
  body: string;
  tag: "release" | "guide" | "note";
}

const POSTS: Post[] = [
  {
    id: "1",
    title: "Shipping the new dashboard",
    body: "A walkthrough of the redesigned dashboard and why we rebuilt it around streaming data.",
    tag: "release",
  },
  {
    id: "2",
    title: "Type-safe routing with TanStack Router",
    body: "How generated route trees and search-param schemas remove a whole class of bugs.",
    tag: "guide",
  },
  {
    id: "3",
    title: "Preloading on intent",
    body: "Hovering a link now kicks off its loader before the click even lands.",
    tag: "guide",
  },
  {
    id: "4",
    title: "Office hours notes",
    body: "Answers to the most common questions from this week's office hours.",
    tag: "note",
  },
  {
    id: "5",
    title: "Deprecating the legacy API",
    body: "The v1 endpoints will be removed next quarter. Here's the migration path.",
    tag: "release",
  },
];

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function fetchPosts(opts: { q?: string; tag?: Post["tag"] }): Promise<Post[]> {
  const results = POSTS.filter((post) => {
    const matchesQuery = opts.q
      ? post.title.toLowerCase().includes(opts.q.toLowerCase())
      : true;
    const matchesTag = opts.tag ? post.tag === opts.tag : true;
    return matchesQuery && matchesTag;
  });
  // Artificial latency so the pending boundary is visible.
  return delay(results, 400);
}

export async function fetchPost(id: string): Promise<Post> {
  const post = POSTS.find((p) => p.id === id);
  if (!post) {
    throw new Error(`Post "${id}" was not found`);
  }
  return delay(post, 400);
}

export const ALL_TAGS = ["release", "guide", "note"] as const;
