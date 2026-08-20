/** @type {import('next').NextConfig} */
export default {
  // `core` shells out to `claude` and `gitleaks`, spawns package installs, and locates its
  // prompt templates with `new URL('../../../../prompts/', import.meta.url)`. Bundling it
  // rewrites that path and the build fails on it — so the server keeps requiring `core` at
  // runtime, which also means the UI runs exactly the code the CLI runs.
  experimental: { serverComponentsExternalPackages: ['core'] },
};
