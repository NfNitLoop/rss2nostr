// deno-lint-ignore-file camelcase
// (because the toml format shared with Python uses camel case names.)

import { args, toml, feoblog } from "./deps.ts"

export function CLIOptions() {
    const parser = args.args.with(
        args.EarlyExitFlag("help", {
            describe: "Display help",
            exit() {
                console.log(parser.help())
                return Deno.exit()
            }
        })
    ).with(
        args.BinaryFlag("profiles", {
            describe: "Should we set profiles for these feeds? (Only need to do once.)"
        })
    ).with(
        args.PartialOption("config", {
            describe: "The path to the config file",
            type: args.Text,
            default: "./rss2feoblog.toml",
        })
    ).with(
        args.CountFlag("quiet", {
            alias: ["q"],
            describe: "Output fewer logs",
        })
    )
    .with(
        args.CountFlag("verbose", {
            alias: ["v"],
            describe: "Output more logs", 
        })
    )

    return parser
}


export type Config = {
    // Which FeoBlog server should we post the data to?
    server_url: string,

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
            const pkey = await feoblog.PrivateKey.fromString(feed.password)

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