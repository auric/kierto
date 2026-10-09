// Bitbucket Server REST 1.0 payloads. Only the used fields are parsed; zod strips the rest.
// Enum-like fields stay z.string(): real streams carry values beyond the documented ones.
import { z } from "zod";

export const user = z.object({ slug: z.string(), displayName: z.string() });

const ref = z.object({
  displayId: z.string(),
  latestCommit: z.string(),
  repository: z.object({ slug: z.string(), project: z.object({ key: z.string() }) }),
});

export const pullRequest = z.object({
  id: z.number(),
  version: z.number(),
  title: z.string(),
  description: z.string().optional(),
  state: z.string(),
  updatedDate: z.number(),
  author: z.object({ user }),
  reviewers: z.array(z.object({ user, status: z.string(), lastReviewedCommit: z.string().optional() })),
  fromRef: ref,
  toRef: ref,
  links: z.object({ self: z.array(z.object({ href: z.string() })).optional() }).optional(),
});

const anchor = z.object({
  path: z.string(),
  line: z.number().optional(),
  lineType: z.string().optional(),
  fileType: z.string().optional(),
  diffType: z.string().optional(),
  fromHash: z.string().optional(),
  toHash: z.string().optional(),
  orphaned: z.boolean().optional(),
});

export type RawComment = {
  id: number;
  version: number;
  text: string;
  author: z.infer<typeof user>;
  createdDate: number;
  updatedDate: number;
  threadResolved?: boolean;
  anchor?: z.infer<typeof anchor>;
  comments?: RawComment[];
};

export const comment: z.ZodType<RawComment> = z.object({
  id: z.number(),
  version: z.number(),
  text: z.string(),
  author: user,
  createdDate: z.number(),
  updatedDate: z.number(),
  threadResolved: z.boolean().optional(),
  anchor: anchor.optional(),
  comments: z.array(z.lazy(() => comment)).optional(),
});

export const activity = z.object({
  id: z.number(),
  action: z.string(),
  commentAction: z.string().optional(),
  comment: comment.optional(),
});

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    start: z.number(),
    isLastPage: z.boolean(),
    nextPageStart: z.number().nullish(),
    values: z.array(item),
  });
