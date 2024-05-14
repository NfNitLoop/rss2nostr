import { assert, assertEquals } from "jsr:@std/assert@^0.222.1";
import { rss } from "./deps.ts";
import { Entry, readRSS } from "./rss.ts";

// Deno.test(async function sampleRss() {
//     const response = await fetch(NYT);
//     const xml = await response.text();
//     console.log("xml:", xml)
//     const feed = await rss.parseFeed(xml);
//     console.log(stringify(feed))
// })

Deno.test(async function testFeeds() {
    for (const url of URLS) {
        const feed = await readRSS(url)
        for (const entry of feed.entries) {
            console.log(stringify(entry))
            checkEntry(entry)
        }
    }
})

// // type UpstreamEntry = rss.Feed["entries"][0]

// function checkEntry(entry: UpstreamEntry) {
//     console.log(JSON.stringify(entry, null, 2))

//     const title = entry.title?.value

//     const content = entry.content?.value
//     ne(content)
//     const contentType = entry.content?.type
//     ne(contentType)

//     ne(title)
//     ne(entry.id)
//     ne(entry.description?.value)
//     assert(entry.published instanceof Date)
// }

function ne(nonEmptyString: string|undefined): asserts nonEmptyString {
    assert(nonEmptyString)
    assertEquals(typeof nonEmptyString, "string")
    assert(nonEmptyString.trim().length > 0)
}

const NYT = "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"

const VERGE = "https://www.theverge.com/rss/index.xml"
const KOTAKU = "https://kotaku.com/rss"

const URLS = [
    NYT,
    VERGE,
    KOTAKU,
    "https://deno.com/feed",
    "https://www.skypack.dev/blog/feed/",
    "https://blog.rust-lang.org/feed",
    "https://feeds.npr.org/1001/rss.xml",
    "https://feeds.feedburner.com/motherjones/feed",
]

function stringify(value: unknown): string {
    return JSON.stringify(value, null, 2)
}

function checkEntry(entry: Entry) {
    assert(entry.published instanceof Date)
    assert(entry.modified instanceof Date)
}
