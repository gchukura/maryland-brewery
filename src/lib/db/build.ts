/** True inside `next build` (including its page-rendering workers). */
export function isProductionBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

/**
 * The Error to throw for a failed read. Read functions never turn a failure into [] or null:
 * during `next build` that would ship empty pages, and at runtime an ISR revalidation would cache
 * an empty page or a 404 (a quota or outage then deletes the site's pages from search). Throwing
 * fails the build, keeps the last good page during revalidation, and gives uncached pages a 500.
 * Supabase errors are plain objects, so they are wrapped to keep their message.
 */
export function readError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : JSON.stringify(error);
  return new Error(`Data read failed: ${message}`, { cause: error });
}
