export interface Post {
  id: string;
  title: string;
  body: string;
  tag: "release" | "guide" | "note";
}

let posts: Post[] = [
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

let nextId = posts.length + 1;

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Any write whose title/body contains "fail" rejects, so optimistic
// rollback can be exercised on demand without flaky randomness.
function maybeFail(...fields: string[]) {
  if (fields.some((f) => f.toLowerCase().includes("fail"))) {
    throw new Error("The server rejected this write");
  }
}

export const ALL_TAGS = ["release", "guide", "note"] as const;

export async function fetchPosts(opts: { q?: string; tag?: Post["tag"] }): Promise<Post[]> {
  const results = posts.filter((post) => {
    const matchesQuery = opts.q
      ? post.title.toLowerCase().includes(opts.q.toLowerCase())
      : true;
    const matchesTag = opts.tag ? post.tag === opts.tag : true;
    return matchesQuery && matchesTag;
  });
  // Artificial latency so pending/background-refetch states are visible.
  return delay(results, 400);
}

export async function fetchPost(id: string): Promise<Post> {
  const post = posts.find((p) => p.id === id);
  if (!post) {
    throw new Error(`Post "${id}" was not found`);
  }
  return delay(post, 400);
}

export interface CreatePostInput {
  title: string;
  body: string;
  tag: Post["tag"];
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  maybeFail(input.title, input.body);
  const post: Post = { id: String(nextId++), ...input };
  posts = [post, ...posts];
  return delay(post, 400);
}

export interface UpdatePostInput {
  id: string;
  title: string;
  body: string;
  tag: Post["tag"];
}

export async function updatePost(input: UpdatePostInput): Promise<Post> {
  maybeFail(input.title, input.body);
  const existing = posts.find((p) => p.id === input.id);
  if (!existing) {
    throw new Error(`Post "${input.id}" was not found`);
  }
  const updated: Post = { ...existing, ...input };
  posts = posts.map((p) => (p.id === input.id ? updated : p));
  return delay(updated, 400);
}

export async function deletePost(id: string): Promise<{ id: string }> {
  posts = posts.filter((p) => p.id !== id);
  return delay({ id }, 400);
}
