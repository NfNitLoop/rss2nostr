// deno-lint-ignore-file camelcase
// (because the toml format shared with Python uses camel case names.)

import { toml } from "./deps.ts"
import { z } from "./deps/zod.ts";
import { log, errorContext } from "./logging.ts";

// TODO: Support nicer npub/nsec formats here:
// ex: 
// npub187rl8jacd3n6d408kfrmfhg4m4z8u7k2degnm7zzt4g8r6m2hmwsc8whn2 
//     = 3f87f3cbb86c67a6d5e7b247b4dd15dd447e7aca6e513df8425d5071eb6abedd
// nsec19ulzkjjl3ul50s77c42stdkrw20zklycqr30t0fvrpxcgku6uu2qjjhv0q
//     = 2f3e2b4a5f8f3f47c3dec55505b6c3729e2b7c9800e2f5bd2c184d845b9ae714

const Npub = z.string().length(64).regex(/^[0-9a-f]+$/i)
const Nsec = Npub

const Profile = z.object({
    name: z.string(),
    npub: Npub,
    nsec: Nsec,
}).strict()

export type Feed = z.infer<typeof Feed>
export const Feed = Profile.extend({
    rssUrl: z.string(),
}).strict()

export type Config = z.infer<typeof Config>
export const Config = z.object({
    destRelays: z.array(z.string()).min(1),

    parentProfile: Profile.optional(),

    feeds: z.array(Feed)
}).strict()

export async function load(fileName: string): Promise<Config> {
    log.debug("Loading config from:", fileName)

    return await errorContext(
        `Reading ${fileName}`,
        async () => {
            const data = toml.parse(await loadFile(fileName))
            return Config.parse(data)
        }
    )
}

async function loadFile(fileName: string): Promise<string> {
    try {
        return await Deno.readTextFile(fileName)
    } catch (error) {
        throw new Error(`Error reading file "${fileName}": ${error}`)
    }
}