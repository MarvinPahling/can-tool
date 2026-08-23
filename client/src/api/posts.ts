import {
  createPost as createPostCommand,
  deletePost as deletePostCommand,
  fetchPost as fetchPostCommand,
  fetchPosts as fetchPostsCommand,
  updatePost as updatePostCommand,
} from "../generated/commands";
import type { CreatePostInput, DeletePostResult, Post, UpdatePostInput } from "../generated/types";

export type { CreatePostInput, Post, UpdatePostInput };

export const ALL_TAGS = ["release", "guide", "note"] as const satisfies readonly Post["tag"][];

export async function fetchPosts(opts: { q?: string; tag?: Post["tag"] }): Promise<Post[]> {
  return fetchPostsCommand(opts);
}

export async function fetchPost(id: string): Promise<Post> {
  return fetchPostCommand({ id });
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  return createPostCommand({ input });
}

export async function updatePost(input: UpdatePostInput): Promise<Post> {
  return updatePostCommand({ input });
}

export async function deletePost(id: string): Promise<DeletePostResult> {
  return deletePostCommand({ id });
}
