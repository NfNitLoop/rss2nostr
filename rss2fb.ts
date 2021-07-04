// A script for slurping an RSS feed and pushing it into FeoBlog.
// See: https://github.com/nfnitloop/feoblog/
//
// Written for Deno. 

import { load as loadConfig, Config, Feed } from "./private/config.ts"
import { Logger } from "./private/logging.ts"
import { requestPermissions } from "./private/permissions.ts"
import { feoblog, nhm, rss} from "./private/deps.ts";

async function main() {
    await requestPermissions()

    // TODO: Parse log level from arguments: 
    log.level = "warn"


    // TODO: Pass in as an optional param:
    const configPath = "./rss2feoblog.toml"

    const config = await loadConfig(configPath)

    log.debug(`server URL: ${config.server_url}`)
    const client = new feoblog.Client({baseURL: config.server_url})

    // TODO: Can do these in parallel:
    for (const feedConfig of config.feeds || []) {
        await syncFeed(config, feedConfig, client)
    }
}

// Look, uh, if your RSS feed is giant we're only going to look at the first 200.
const MAX_FEED_ITEMS = 200

async function syncFeed(config: Config, feedConfig: Feed, client: feoblog.Client) {
    log.debug(`Feed: ${feedConfig.name}`)
    let userID = feoblog.UserID.fromString(feedConfig.user_id)

    // TODO: Write profile if it doesn't exist. 

    // Read RSS feed:
    const response = await fetch(feedConfig.rss_url);
    const xml = await response.text();
    log.trace("xml:", xml)
    const { feed } = await rss.deserializeFeed(xml, { outputJsonFeed: true });

    let itemsToStore: FeedItem[] = []
    for (let item of feed.items.slice(0, MAX_FEED_ITEMS)) {

        // Some blogs may only publish a modified date.
        // We'll prefer published, because we're not going to update
        // with each update. And I feel like I should reward people that
        // constantly (re)edit their RSS posts. :p
        let published = item.date_published || item.date_modified

        if (!published) {
            log.warn(`Item does not have a published or modified date. Skipping`)
            continue
        }
        log.trace("title", item.title)
        log.trace("published", published)
        log.trace("content_html", item.content_html)
        log.trace("content_text", item.content_text)
        log.trace("summary", item.summary)

        // Some feeds use "summary" instead of HTML content.
        // But it looks like the RSS library fills in content_html with just the URL,
        // so prefer summary if it exists:
        let html = item.summary || item.content_html || item.content_text

        let markdown = htmlToMarkdown(html)
        if (item.url) { 
            log.trace("url", item.url)
            markdown = addURL(markdown, item.url)
        }
        log.trace("guid", item.id)
        markdown = addGUID(markdown, item.id)

        log.trace("markdown:", markdown)
        log.trace("----")

        let feedItem = new FeedItem({
            guid: item.id,
            published,
            markdown,
            title: item.title
        })
        itemsToStore.push(feedItem)
    }

    if (itemsToStore.length == 0) {
        log.warn("Feed had no items:", feedConfig.name || feedConfig.rss_url)
        return
    }
    log.debug("Found", itemsToStore.length, "in RSS feed")

    // Sort oldest first. We'll sync oldest first to make resuming work better.
    itemsToStore.sort(FeedItem.sortByDate)
    
    // Filter out duplicates by GUID:
    let oldestTimestamp = itemsToStore[0].timestampMsUTC
    let seenGUIDs = await log.time("getSeenGuids()", () => getSeenGUIDs(client, userID, oldestTimestamp))
    log.debug("Found", seenGUIDs.size, "GUIDs")
    itemsToStore = itemsToStore.filter(i => !seenGUIDs.has(i.guid))
    log.debug(itemsToStore.length, "new items remain to be posted")
    if (itemsToStore.length == 0) {
        return
    }

    // PUT items, finally!  Yay!
    await log.time("PUT Items", async () => {
        let privKey = await feoblog.PrivateKey.fromString(feedConfig.password)
        for (let item of itemsToStore) {
            let bytes = item.toProtobuf()
            let sig = privKey.sign(bytes)
            await client.putItem(userID, sig, bytes)
        }
    })
}

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

// Collect GUIDs from previously posted FeoBlog Items:
async function getSeenGUIDs(client: feoblog.Client, userID: feoblog.UserID, oldestTimestamp: number): Promise<Set<string>>
{
    let guids = new Set<string>()

    // NYTimes in particular realllly likes to edit their posts a lot.
    // Look back at least a week from the oldest record we got to make sure
    // we haven't already seen any of these already:
    let cutoff = oldestTimestamp - ONE_WEEK_MS;

    const entries = client.getUserItems(userID)
    let count = 0;
    for await (let entry of entries) {
        if (entry.timestamp_ms_utc < cutoff) { break }

        let sig = feoblog.Signature.fromBytes(entry.signature.bytes)
        log.trace(`FeoBlog Item sig: ${entry.timestamp_ms_utc} ${sig}`)

        let item = await client.getItem(userID, sig)
        let body = item?.post.body
        if (!body) { continue }
        let guid = findGUID(body)
        if (guid) { guids.add(guid) }
    }

    return guids
}

    
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

function htmlToMarkdown(html: string|undefined): string {
    return service.translate(html || "")
}


interface ItemData {
    guid: string,
    title?: string,
    markdown: string,
    published: Date,
}

class FeedItem {
    readonly guid: string
    readonly title: string|undefined
    readonly markdown: string
    readonly published: Date
    readonly timestampMsUTC: number

    constructor({guid, title, markdown, published}: ItemData) {
        this.guid = guid
        this.title = title
        this.markdown = markdown
        this.published = published
        this.timestampMsUTC = published.valueOf()

        if (this.timestampMsUTC == 0) {
            throw "a FeedItem's Date may not be exactly UNIX Epoch."
            // It likely means you've got an error in date parsing somewhere anyway.
        }
    }
    
    static sortByDate(a: FeedItem, b: FeedItem): number {
        return a.timestampMsUTC - b.timestampMsUTC
    }

    toProtobuf(): Uint8Array {
        let item = new feoblog.protobuf.Item({
            timestamp_ms_utc: this.timestampMsUTC,
            // NOTE: No offset, since JS Date (nor rss's JSONFeed data type) support it.
        })

        item.post = new feoblog.protobuf.Post({
            title: this.title,
            body: this.markdown,
        })

        return item.serialize()
    }
}

// Add the RSS item's URL to the end of the article if it's not included already.
function addURL(markdown: string, url: string): string {
    if (markdown.search(url) >= 0) {
        // URL already in the body.
        return markdown
    }

    return (
        markdown.trimRight()
        + "\n\n"
        + `[Continue Reading…](${url})`
    )
}

// Add the RSS item GUID to the end of a post. Allows us to retrieve GUIDs later.
function addGUID(markdown: string, guid: string): string {
    return (
        markdown.trimRight()
        + "\n\n"
        + `<!-- GUID: "${noQuotes(guid)}" -->`
    )
}

// Just remove quotes from GUIDs instead of escaping them:
function noQuotes(value: string): string {
    // also remove > to prevent breaking out of our HTML <!-- comment -->:
    return value.replaceAll(/[">]/g, "")
}

const GUID_PATTERN = /^\<!-- GUID: "([^">]+)" -->/mg

// Find a GUID from a previous post.
function findGUID(markdown: string): string|null {
    let results = [...markdown.matchAll(GUID_PATTERN)]
    if (results.length == 0) {
        return null
    }
    if (results.length > 1) {
        log.warn("Found more than one GUID. Using first one.")
    }

    let match = results[0]
    return match[1] // guid captured in group 1.
}


const log = new Logger();
main()

