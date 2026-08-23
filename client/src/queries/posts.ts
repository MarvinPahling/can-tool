import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPost,
  deletePost,
  fetchPost,
  fetchPosts,
  updatePost,
  type CreatePostInput,
  type Post,
  type UpdatePostInput,
} from "../api/posts";

export interface PostFilters {
  q?: string;
  tag?: Post["tag"];
}

// Domain-shaped key factory: every key is a subset of `all`, so a targeted
// invalidation of `lists()` never touches `detail()` caches and vice versa.
export const postKeys = {
  all: ["posts"] as const,
  lists: () => [...postKeys.all, "list"] as const,
  list: (filters: PostFilters) => [...postKeys.lists(), filters] as const,
  details: () => [...postKeys.all, "detail"] as const,
  detail: (id: string) => [...postKeys.details(), id] as const,
};

export function postsQueryOptions(filters: PostFilters) {
  return queryOptions({
    queryKey: postKeys.list(filters),
    queryFn: () => fetchPosts(filters),
    // List data is cheap to serve slightly stale; this keeps the "stale
    // data" and "background refetch" states honest instead of refetching
    // on every render/focus.
    staleTime: 30_000,
  });
}

export function postQueryOptions(id: string) {
  return queryOptions({
    queryKey: postKeys.detail(id),
    queryFn: () => fetchPost(id),
    staleTime: 30_000,
  });
}

/** Every cached list, regardless of filter combination. */
function listsQueryKey() {
  return { queryKey: postKeys.lists() };
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) => createPost(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries(listsQueryKey());
      const previousLists = queryClient.getQueriesData<Post[]>(listsQueryKey());

      const optimisticPost: Post = { id: `optimistic-${Date.now()}`, ...input };
      queryClient.setQueriesData<Post[]>(listsQueryKey(), (old) =>
        old ? [optimisticPost, ...old] : old,
      );

      return { previousLists };
    },
    onError: (_err, _input, context) => {
      context?.previousLists.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries(listsQueryKey());
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePostInput) => updatePost(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries(listsQueryKey());
      await queryClient.cancelQueries({ queryKey: postKeys.detail(input.id) });

      const previousLists = queryClient.getQueriesData<Post[]>(listsQueryKey());
      const previousDetail = queryClient.getQueryData<Post>(postKeys.detail(input.id));

      queryClient.setQueriesData<Post[]>(listsQueryKey(), (old) =>
        old?.map((post) => (post.id === input.id ? { ...post, ...input } : post)),
      );
      queryClient.setQueryData<Post>(postKeys.detail(input.id), (old) =>
        old ? { ...old, ...input } : old,
      );

      return { previousLists, previousDetail };
    },
    onError: (_err, input, context) => {
      context?.previousLists.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.previousDetail) {
        queryClient.setQueryData(postKeys.detail(input.id), context.previousDetail);
      }
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries(listsQueryKey());
      queryClient.invalidateQueries({ queryKey: postKeys.detail(input.id) });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deletePost(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries(listsQueryKey());
      const previousLists = queryClient.getQueriesData<Post[]>(listsQueryKey());

      queryClient.setQueriesData<Post[]>(listsQueryKey(), (old) =>
        old?.filter((post) => post.id !== id),
      );

      return { previousLists };
    },
    onError: (_err, _id, context) => {
      context?.previousLists.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: (_data, _err, id) => {
      queryClient.invalidateQueries(listsQueryKey());
      queryClient.removeQueries({ queryKey: postKeys.detail(id) });
    },
  });
}
