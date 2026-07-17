// Vitest stand-in for the `server-only` package. `server-only`'s real
// implementation throws when imported outside a Next.js server bundle,
// which includes the vitest (Node, but not Next.js-bundled) environment —
// this empty module lets `import "server-only"` resolve as a no-op in
// tests while still doing its real job (a build-time error on accidental
// client-bundle import) in the actual Next.js build.
export {};
