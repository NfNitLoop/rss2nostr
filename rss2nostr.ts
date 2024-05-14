#!/usr/bin/env -S deno run --allow-read --allow-net --deny-env
/**
 * A script for slurping an RSS feed and pushing it into Nostr.
 * 
 * Written for Deno. 
 * @module
 */

import { load as loadConfig, type Feed } from "./src/config.ts"
import { errorContext, log } from "./src/logging.ts"
import { requestPermissions } from "./src/permissions.ts"
import { htmlToMarkdown } from "./src/markdown.ts";
import { Command } from "./src/deps/cliffy/command.ts";
import { Client } from "./src/deps/nostrilo/client.ts"; 
import * as nostr from "./src/deps/nostrilo/nostr.ts"
import { LocalSigner } from "./src/deps/nostrilo/signer.ts";
import { readRSS } from "./src/rss.ts";


async function main(args: string[]): Promise<void> {

    const cmd = new Command()
        .name("rss2nostr")
        .version("0.1.0")
        .description("Convert an RSS feed into Nostr posts")
        .globalOption("--verbose", "Increase output verbosity", {default: false, action: () => log.increaseLevel(1), collect: true})
        .globalOption("--quiet", "Descrease output verbosity", {default: false, action: () => log.increaseLevel(-1), collect: true})
        .globalOption("--config <configFile:string>", "Configuration file to load", {
            default: "rss2nostr.toml"
        })
        .action(() => { cmd.showHelp() })

    const sync = new Command<GlobalOptions>()
        .name("syncOnce")
        .description("Do one synchronization of RSS")
        .action(cmd_sync)
    cmd.command(sync.getName(), sync)

    const profiles = new Command<GlobalOptions>()
        .name("updateProfiles")
        .alias("up")
        .description("Update (or create) Nostr profiles for each RSS feed.")
        .action(cmd_profiles)
    cmd.command(profiles.getName(), profiles)

    await cmd.parse(args)
}

type GlobalOptions = {
    config: string

    // Not actually used, just here for the action side-effects in Command.
    verbose: boolean[]
    quiet: boolean[]
}

async function cmd_sync(options: GlobalOptions): Promise<void> {
    await requestPermissions()

    log.debug("options:", options)    
    log.debug("Loading config from:", options.config)
    const config = await loadConfig(options.config)

    log.debug(`relay URLs: ${config.destRelays}`)

    const mainRelay = config.destRelays[0]

    using mainClient = Client.connect(mainRelay)

    const errors = []

    // TODO: Can do these in parallel? But logging might get noisy.
    for (const feedConfig of config.feeds) {
        // Don't stop syncing all feeds due to an error in one:
        try {
            await errorContext(
                `Syncing items for ${feedConfig.name || feedConfig.rssUrl}`,
                () => syncFeed(feedConfig, mainClient)
            )
        } catch (error) {
            errors.push(error)
        }
    }

    if (errors.length > 0) {
        for (const error of errors) {
            log.error(error)
        }

        throw new Error(`See above ${errors.length} error messages.`)
    }
}


async function cmd_profiles(options: GlobalOptions) {
    // TODO: Move boilerplate into function itself:
    log.debug("Loading config from:", options.config)
    const config = await loadConfig(options.config)
    // TODO: Support multiple clients.
    using client = Client.connect(config.destRelays[0])

    for (const feedConfig of config.feeds) {
        await errorContext(
            `Updating profile for ${feedConfig.name || feedConfig.rssUrl}`,
            () => updateProfile(feedConfig, client)
        )
    }
    log.info("")
    log.info("Profile sync completed.")
}

// Look, uh, if your RSS feed is giant we're only going to look at the first 200.
const MAX_FEED_ITEMS = 200

async function syncFeed(feedConfig: Feed, client: Client) {
    log.info(`Syncing Feed: ${feedConfig.name || feedConfig.rssUrl}`)

    const feed = await readRSS(feedConfig.rssUrl)
    let itemsToStore: FeedItem[] = []
    for (const item of feed.entries.slice(0, MAX_FEED_ITEMS)) {

        // Some blogs may only publish a modified date.
        // We'll prefer published, because we're not going to update
        // with each update. And I feel like I shouldn't reward people that
        // constantly (re)edit their RSS posts. :p
        // We *could* change this in Nostr, since it supports replaceable events.

        log.trace("title", item.title)
        log.trace("published", item.published)
        log.trace("content", item.content)
        log.trace("contentType", item.contentType)

        
        // content might be plaintext, but that's also typically valid HTML.
        let markdown = htmlToMarkdown(item.content)

        if (item.url) { 
            log.trace("url", item.url)
            markdown = addURL(markdown, item.url)
        }
        log.trace("guid", item.id)

        if (!item.id) {
            log.warn("Skipping item with no id:", item.title)
            continue
        }

        log.trace("markdown:", markdown)
        log.trace("----")

        const feedItem = new FeedItem({
            guid: item.id,
            destUrl: item.url,
            published: item.published,
            markdown,
            title: item.title
        })
        itemsToStore.push(feedItem)
    }

    if (itemsToStore.length == 0) {
        log.warn("Feed had no items:", feedConfig.name || feedConfig.rssUrl)
        return
    }
    log.debug("Found", itemsToStore.length, "in RSS feed")

    // Sort oldest first. We'll sync oldest first to make resuming work better.
    itemsToStore.sort(FeedItem.sortByDate)

    const {npub, nsec} = feedConfig
    const signer = new LocalSigner(npub, nsec)


    // Filter out duplicates by GUID:
    const oldestTimestamp = itemsToStore[0].timestampSecUTC
    const seenGUIDs = await log.time("getSeenGuids()", () => getSeenGUIDs(client, npub, oldestTimestamp))
    log.debug("Found", seenGUIDs.size, "GUIDs")
    itemsToStore = itemsToStore.filter(i => !seenGUIDs.has(i.guid))
    log.debug(itemsToStore.length, "new items remain to be posted")
    if (itemsToStore.length == 0) {
        return
    }


    let successCount = 0
    let failCount = 0

    // PUT items, finally!  Yay!
    await log.time("Send Items", async () => {
        for (const item of itemsToStore) {
            const event = await signer.sign(item.toEvent())
            const { published } = await client.tryPublish(event)
            if (published) {
                successCount++
            } else {
                failCount++
            }
        }
    })

    log.info("Published", successCount, "new items")
    if (failCount > 0) {
        log.warn("Failed to publish", failCount, "items")
    }
}

async function updateProfile(feedConfig: Feed, client: Client): Promise<"published" | "skipped" | "error"> {
    const aboutText = [
        `Posts from <${feedConfig.rssUrl}>`,
        "",
        "Sync'd by rss2nostr",
        // TODO: Add link to the above once I publish this.
    ].join("\n")

    const newProfile = new Profile({
        displayName: feedConfig.name,
        aboutText
    })

    const {npub, nsec} = feedConfig
    const result = await client.getProfile(npub)
    if (result) {
        log.debug("Got old profile:", result)
        const oldProfile = Profile.fromEvent(result)
        if (oldProfile.sameAs(newProfile)) {
            log.debug("Profile already updated for", oldProfile.displayName)
            return "skipped"
        }
    } else {
        log.debug("No profile found for", newProfile.displayName)
    }

    
    const signer = new LocalSigner(npub, nsec)
    const event = await signer.sign(newProfile.toEvent())
    const {published} = await client.tryPublish(event)
    if (published) {
        log.info("Updated profile for", newProfile.displayName)
        return "published"
    } else {
        log.warn("Couldn't send profile to", client.url, "for", newProfile, npub)
        return "error"
    }

}

class Profile {
  displayName: string;
  aboutText: string;

    constructor(args: {
        displayName: string,
        aboutText: string,
    }) {
        this.displayName = args.displayName
        this.aboutText = args.aboutText
    }

    sameAs(other: Profile) {
        return this.displayName == other.displayName && this.aboutText == other.aboutText
    }

    static fromEvent(event: nostr.Event): Profile {
        let displayName = ""
        let aboutText = ""
        try {
            const data = JSON.parse(event.content)
            const {name, about} = data

            if ((typeof name) == "string") { displayName = name }
            if ((typeof about) == "string") { aboutText = about }
        } catch (err: unknown) {
            log.debug("Couldn't parse event", event, err)
        }

        return new Profile({displayName, aboutText})
    }

    toEvent(): nostr.UnsignedEvent {
        // See: https://github.com/nostr-protocol/nips/blob/master/01.md#kinds
        const profileData = {
            name: this.displayName,
            about: this.aboutText,
            // picture: string // url.
        }
        
        return {
            kind: 0,
            created_at: Math.floor(Date.now().valueOf() / 1000),
            tags: [],
            content: JSON.stringify(profileData)
        }
    }
}

const ONE_WEEK_SECS = 60 * 60 * 24 * 7;

// Collect GUIDs from previously posted Items:
async function getSeenGUIDs(client: Client, npub: string, oldestTimestamp: number): Promise<Set<string>>
{
    const guids = new Set<string>()

    // NYTimes in particular realllly likes to edit their posts a lot.
    // Look back at least a week from the oldest record we got to make sure
    // we haven't already seen any of these already:
    const cutoff = oldestTimestamp - ONE_WEEK_SECS;

    const filter = {
        authors: [npub],
        limit: 200, // 
        since: cutoff,
    } as const

    const events = await client.querySimple(filter)
    for await (const event of events) {
        const guid = findGUID(event)
        if (guid) { guids.add(guid) }
    }

    return guids
}

function findGUID(event: nostr.Event): string|null {
    const guids = event.tags.filter(t => t[0] == "d")
    if (guids.length == 0) {
        return null
    }
    return guids[0][1]
}

    


interface ItemData {
    destUrl: string|undefined,
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
    readonly destUrl?: string

    constructor({guid, title, markdown, published, destUrl}: ItemData) {
        this.guid = guid
        this.title = title
        this.markdown = markdown
        this.published = published
        this.timestampMsUTC = published.valueOf()
        this.destUrl = destUrl

        if (this.timestampMsUTC == 0) {
            throw "a FeedItem's Date may not be exactly UNIX Epoch."
            // It likely means you've got an error in date parsing somewhere anyway.
        }
    }

    get timestampSecUTC(): number {
        return Math.floor(this.timestampMsUTC / 1000)
    }
    
    static sortByDate(a: FeedItem, b: FeedItem): number {
        return a.timestampMsUTC - b.timestampMsUTC
    }

    toEvent(): nostr.UnsignedEvent {
        if (this.guid.trim().length == 0) {
            throw new Error(`GUID is not allowed to be empty.`)
        }
        const tags: nostr.Tag[] = [
            ["d", this.guid],
            ["published_at", `${this.timestampSecUTC}`]
        ]
        if (this.destUrl) {
            // See: https://github.com/nostr-protocol/nips/blob/master/48.md
            tags.push(["proxy", this.destUrl, "web"])
        }
        if (this.title) {
            tags.push(["title", this.title])
        }

        return {
            content: this.markdown,
            tags,
            created_at: this.timestampSecUTC,
            kind: nostr.KINDS.k30023_long_form_text,
        }
    }
}

// Add the RSS item's URL to the end of the article if it's not included already.
function addURL(markdown: string, url: string): string {
    if (markdown.search(url) >= 0) {
        // URL already in the body.
        return markdown
    }

    return (
        markdown.trimEnd()
        + "\n\n"
        + `[Continue Reading…](${url})`
    )
}




// --------------------------
if (import.meta.main) {
    try {
        await main(Deno.args)
    } catch (error) {
        console.error(error)
        Deno.exit(1)
    }
}



