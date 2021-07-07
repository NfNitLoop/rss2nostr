// A script for slurping an RSS feed and pushing it into FeoBlog.
// See: https://github.com/nfnitloop/feoblog/
//
// Written for Deno. 

import { load as loadConfig, Feed, CLIOptions } from "./private/config.ts"
import { errorContext, Logger } from "./private/logging.ts"
import { requestPermissions } from "./private/permissions.ts"
import { feoblog, nhm, rss} from "./private/deps.ts";

const log = new Logger();

async function main(): Promise<number> {
    await requestPermissions()

    const result = CLIOptions().parse(Deno.args)
    if (!result.value) { 
        log.error("Couldn't parse CLI options", result.error)
        return 1
    }
    const options = result.value
    log.debug("options:", options)

    log.increaseLevel(options.verbose - options.quiet)
    log.debug("Log level:", log.level)
    
    log.debug("Loading config from:", options.config)
    const config = await errorContext(
        `Reading ${options.config}`,
        () => loadConfig(options.config)
    )

    log.debug(`server URL: ${config.server_url}`)
    const client = new feoblog.Client({baseURL: config.server_url})

    if (!config.feeds) {
        log.error("No feeds defined in config file:", options.config)
        return 1
    }

    if (options.profiles) {
        for (const feedConfig of config.feeds) {
            await errorContext(
                `Updating profile for ${feedConfig.name || feedConfig.rss_url}`,
                () => updateProfile(feedConfig, client)
            )
        }
        log.info("")
        log.info("Profile sync completed. Now run without `--profiles` to sync posts.")
        return 0
    }

    const errors = []

    // TODO: Can do these in parallel? But logging might get noisy.
    for (const feedConfig of config.feeds) {
        // Don't stop syncing all feeds due to an error in one:
        try {
            await errorContext(
                `Syncing items for ${feedConfig.name || feedConfig.rss_url}`,
                () => syncFeed(feedConfig, client)
            )
        } catch (error) {
            errors.push(error)
        }
    }

    if (errors.length > 0) {
        for (const error of errors) {
            log.error(error)
        }

        return 1
    }

    return 0
}

// Look, uh, if your RSS feed is giant we're only going to look at the first 200.
const MAX_FEED_ITEMS = 200

async function syncFeed(feedConfig: Feed, client: feoblog.Client) {
    log.info(`Syncing Feed: ${feedConfig.name || feedConfig.rss_url}`)
    const userID = feoblog.UserID.fromString(feedConfig.user_id)

    const feed = await readRSS(feedConfig.rss_url)
    let itemsToStore: FeedItem[] = []
    for (const item of feed.items.slice(0, MAX_FEED_ITEMS)) {

        // Some blogs may only publish a modified date.
        // We'll prefer published, because we're not going to update
        // with each update. And I feel like I should reward people that
        // constantly (re)edit their RSS posts. :p
        const published = item.date_published || item.date_modified

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
        const html = asString(item.summary || item.content_html || item.content_text)

        let markdown = htmlToMarkdown(html)
        if (item.url) { 
            log.trace("url", item.url)
            markdown = addURL(markdown, item.url)
        }
        log.trace("guid", item.id)
        markdown = addGUID(markdown, item.id)

        log.trace("markdown:", markdown)
        log.trace("----")

        const feedItem = new FeedItem({
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
    const oldestTimestamp = itemsToStore[0].timestampMsUTC
    const seenGUIDs = await log.time("getSeenGuids()", () => getSeenGUIDs(client, userID, oldestTimestamp))
    log.debug("Found", seenGUIDs.size, "GUIDs")
    itemsToStore = itemsToStore.filter(i => !seenGUIDs.has(i.guid))
    log.debug(itemsToStore.length, "new items remain to be posted")
    if (itemsToStore.length == 0) {
        return
    }

    // PUT items, finally!  Yay!
    await log.time("PUT Items", async () => {
        const privKey = await feoblog.PrivateKey.fromString(feedConfig.password)
        for (const item of itemsToStore) {
            const bytes = item.toProtobuf()
            const sig = privKey.sign(bytes)
            await client.putItem(userID, sig, bytes)
        }
    })
}

// Work around: https://github.com/MikaelPorttila/rss/issues/32
function asString(s: string|undefined): string|undefined {
    if (typeof s === "string") return s
    return undefined
}

async function updateProfile(feedConfig: Feed, client: feoblog.Client) {
    let displayName = feedConfig.name
    if (!displayName) { 
        log.debug("No title specified for", feedConfig.rss_url)
        log.debug("Fetching from RSS.")
        const feed = await readRSS(feedConfig.rss_url)
        log.debug("Got title:", feed.title)
        displayName = feed.title
    }

    const profileText = [
        `Posts from <${feedConfig.rss_url}>`,
        "",
        "Sync'd by [rss2fb](https://deno.land/x/rss2fb)",
    ].join("\n")

    const userID = feoblog.UserID.fromString(feedConfig.user_id)
    const result = await client.getProfile(userID)
    if (result) {
        const profile = result.item.profile
        if (profile.display_name == displayName && profile.about == profileText) {
            log.info("Profile already updated for", displayName)
            return
        }
    }

    const item = new feoblog.protobuf.Item({
        timestamp_ms_utc: (new Date()).valueOf(),
    })
    item.profile = new feoblog.protobuf.Profile({
        display_name: displayName,
        about: profileText
    })

    const privKey = await feoblog.PrivateKey.fromString(feedConfig.password)
    const itemBytes = item.serialize()
    const sig = privKey.sign(itemBytes)
    await client.putItem(userID, sig, itemBytes)
    log.info("Updated profile for", displayName)
}

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

// Collect GUIDs from previously posted FeoBlog Items:
async function getSeenGUIDs(client: feoblog.Client, userID: feoblog.UserID, oldestTimestamp: number): Promise<Set<string>>
{
    const guids = new Set<string>()

    // NYTimes in particular realllly likes to edit their posts a lot.
    // Look back at least a week from the oldest record we got to make sure
    // we haven't already seen any of these already:
    const cutoff = oldestTimestamp - ONE_WEEK_MS;

    const entries = client.getUserItems(userID)
    for await (const entry of entries) {
        if (entry.timestamp_ms_utc < cutoff) { break }

        const sig = feoblog.Signature.fromBytes(entry.signature.bytes)
        log.trace(`FeoBlog Item sig: ${entry.timestamp_ms_utc} ${sig}`)

        const item = await client.getItem(userID, sig)
        const body = item?.post?.body
        if (!body) { continue }
        const guid = findGUID(body)
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
        const item = new feoblog.protobuf.Item({
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
    const results = [...markdown.matchAll(GUID_PATTERN)]
    if (results.length == 0) {
        return null
    }
    if (results.length > 1) {
        log.warn("Found more than one GUID. Using first one.")
    }

    const match = results[0]
    return match[1] // guid captured in group 1.
}

async function readRSS(url: string): Promise<rss.JsonFeed> {
    const response = await fetch(url);
    const xml = await response.text();
    log.trace("xml:", xml)
    const { feed } = await rss.deserializeFeed(xml, { outputJsonFeed: true });
    return feed
}


// --------------------------
try {
    Deno.exit(await main())
} catch (error) {
    console.error(error)
    Deno.exit(1)
}


