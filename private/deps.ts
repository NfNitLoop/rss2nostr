// TODO: more precise exports here?

// std:
export * as toml from "https://deno.land/std@0.100.0/encoding/toml.ts"

// third-party:
export * as rss from "https://deno.land/x/rss@0.3.6/mod.ts"

export * as feoblog from "https://deno.land/x/feoblog_client@v0.1.2/mod.ts"


// Turndown: https://github.com/domchristie/turndown
// Note: NO ?dts, because the types reference browser-only types.
// Aww, blocked on: https://github.com/mixmark-io/turndown/issues/390
// export { default as TurndownService } from "https://cdn.skypack.dev/turndown@v7.1.1/lib/turndown.umd.js"

// this looks good: 
// https://github.com/crosstype/node-html-markdown#readme
// But the types are currently broken by: 
// https://github.com/denoland/deno/issues/11140
// export * as h2md from "https://cdn.skypack.dev/node-html-markdown@v0.1.7?dts"
// I guess I can use it without typescript types for now:
export * as nhm from "https://cdn.skypack.dev/node-html-markdown@v0.1.7"

export * as args from "https://deno.land/x/args@2.1.1/index.ts"