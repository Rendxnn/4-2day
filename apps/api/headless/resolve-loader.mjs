/**
 * Resolve extensionless relative imports used by the Worker-oriented TypeScript
 * modules when the local headless CLI runs directly on Node.js.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw error;
    }

    const candidates = [
      `${specifier}.ts`,
      `${specifier}.js`,
      `${specifier}.mjs`,
      `${specifier}/index.ts`,
      ...(specifier.endsWith(".js") ? [`${specifier.slice(0, -3)}.ts`] : []),
    ];

    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Try the next local extension before returning the original error.
      }
    }

    throw error;
  }
}
