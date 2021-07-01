type RequiredPermission = {
    permission: Deno.PermissionDescriptor,
    reason: string,
}

// TODO: Build permissions more graunlarly from options/config.
const permissionRequirements: RequiredPermission[] = [
    {
        permission: { name: "read", path: "./rss2feoblog.toml" } as const,
        reason: "We need to read your configuration file from the current directory.",
    },
    {
        permission: { name: "net" } as const,
        reason: "We'll communicate w/ RSS feeds and FeoBlog over the network.",
    }
]

export async function requestPermissions() {

    for (const req of permissionRequirements) {
        let result = await Deno.permissions.query(req.permission)
        if (result.state === "granted") { continue }

        console.warn(`⚠ ${req.reason}`)
        result = await Deno.permissions.request(req.permission)

        if (result.state != "granted") {
            throw "Aborting because user denied permissions."
        }
    }
}
