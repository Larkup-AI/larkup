/** Remove optional capabilities that are unavailable in the current runtime. */
export function executableTools<T extends Record<string, unknown>>(candidates: T) {
  return Object.fromEntries(
    Object.entries(candidates).filter(([, definition]) => definition != null),
  ) as { [K in keyof T as T[K] extends null | undefined ? never : K]: NonNullable<T[K]> };
}
