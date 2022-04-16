
import { nhm } from "./deps.ts";

// node-html-markdown is the best html-to-markdown parser I've found that
// works with Deno at the moment.
// However, I'd really love to be able to use `[link]: url` style links to 
// make the markdown more readable in markdown (as well as HTML).
// TODO: 
//  * Use Turndown (once https://github.com/mixmark-io/turndown/issues/390 is fixed?)
//  * Or wait for https://github.com/crosstype/node-html-markdown/issues/15
//  * Or find something else to post-process the markdown to how I want it?
const service = new nhm.NodeHtmlMarkdown({
    // https://github.com/crosstype/node-html-markdown#readme
})

export function htmlToMarkdown(html?: string): string {
    return service.translate(html || "")
}
