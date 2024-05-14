/**
 * My own wrappers around RSS parsers to shield myself from their changing APIs.
 */

import { rss } from "./deps.ts"
import { log } from "./logging.ts";

export type Feed = {
    entries: Entry[]
}

export type Entry = {
    id?: string
    title: string
    published: Date
    modified: Date
    content: string
    url?: string

    /** If we get info about the content type, it's here: */
    contentType?: ContentType
}

type ContentType = "html" | "text"

export async function readRSS(url: string): Promise<Feed> {
    const response = await fetch(url);
    const xml = await response.text();
    log.trace("xml:", xml)
    const feed = await rss.parseFeed(xml);

    return {
        entries: feed.entries.map(getEntry)
    }
}

type UpstreamEntry = rss.Feed["entries"][0]

function getEntry(value: UpstreamEntry): Entry {
    const {id, description, links} = value

    let content: string
    let contentType: ContentType|undefined = undefined

    if (value.content?.value) {
        content = value.content.value
        contentType = textType(value.content)
    } else if (description?.value) {
        content = description.value
        contentType = textType(description)
    } else {
        throw new Error(`Couldn't extract content for ${value.id}`)
    }

    const published = value.published || value.updated
    const modified = value.updated || value.published
    if (!published || !modified) {
        throw new Error(`Couldn't extract published date for ${value.id}`)
    }

    const title = value.title?.value
    if (!title) { 
        throw new Error(`couldn't extract title for ${value.id}`)
    }

    let url: Entry["url"] = undefined

    if (links.length > 0) {
        if (links[0].href) {
            url = links[0].href
        }
    }
    
    const entry: Entry = {
        id,
        title,
        published,
        modified,
        content,
        contentType,
        url,
    }

    return entry
}


type TypeField = Exclude<rss.Feed["entries"][0]["description"], undefined>


function textType(value: TypeField): ContentType | undefined {
    const vt = value.type
    if (vt == "xhtml") {
        return "html"
    }
    if (vt == "html" || vt == "text") {
        return vt
    }
    return undefined
}