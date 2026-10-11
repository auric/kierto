// scripts/compile.ts sets REVIEW_LOOP_COMMIT with --define. When Bun runs the source, the name is not declared.
declare const REVIEW_LOOP_COMMIT: string | undefined;

// The commit of a compiled binary. null when Bun runs the source.
export const BUILD_COMMIT: string | null = typeof REVIEW_LOOP_COMMIT === "string" ? REVIEW_LOOP_COMMIT : null;
export const COMPILED = BUILD_COMMIT !== null;
