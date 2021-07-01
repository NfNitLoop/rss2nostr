// A script for slurping an RSS feed and pushing it into FeoBlog.
// See: https://github.com/nfnitloop/feoblog/
//
// Written for Deno. 

import { requestPermissions } from "./private/permissions.ts"
import { load as loadConfig } from "./private/config.ts"
import { feoblog } from "./private/deps.ts";


async function main() {
    await requestPermissions()

    // TODO: Pass in as an optional param:
    const configPath = "./rss2feoblog.toml"

    const config = await loadConfig(configPath)
    console.log(config)

    console.log(`server URL: ${config.server_url}`)
    for (const feed of config.feeds || []) {
        console.log(`feed: ${feed.name}`)
    }

    const client = new feoblog.Client({baseURL: config.server_url})
    
}




main()