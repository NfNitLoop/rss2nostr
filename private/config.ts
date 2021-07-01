// deno-lint-ignore-file camelcase
// (because the toml format shared with Python uses camel case names.)

import { toml, feoblog } from "./deps.ts"



export type Config = {
    // Which FeoBlog server should we post the data to?
    server_url: string,

    // TODO: Remove? 
    // TODO: Could use localStorage instead but ehhhh....
    // cache_dir: string,

    feeds?: Feed[]
}

export type Feed = {
    // Used to create a name for the stream in FeoBlog if it's not yet named in a profile.
    name?: string,

    // Where to fetch the RSS from.
    rss_url: string,

    // FeoBlog userID to post to.
    user_id: string,

    // FeoBlog password (private key) used to sign the data we post.
    password: string,
}

export async function load(fileName: string): Promise<Config> {

    const config = toml.parse(await loadFile(fileName)) as Config

    const feeds = config.feeds || []
    if (feeds.length == 0) {
        throw "No feeds specified"
    }

    for (const feed of feeds) {
        let userID
        try {
            userID = feoblog.UserID.fromString(feed.user_id)
        } catch (_) {
            throw `Invalid userID: "${feed.user_id}"`
        }

        try {
            let pkey = await feoblog.PrivateKey.fromString(feed.password)

            if (userID.toString() != pkey.userID.toString()) {
                throw `Expected a password for ${userID} but found one for ${pkey.userID}`
            }

        } catch (error) {
            throw `Error while validating user "${userID}": ${error}`
        }
    }

    // TODO: More validation here

    return config

}

async function loadFile(fileName: string): Promise<string> {
    try {
        return await Deno.readTextFile(fileName)
    } catch (error) {
        throw new Error(`Error reading file "${fileName}": ${error}`)
    }
}