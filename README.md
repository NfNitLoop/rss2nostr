RSS to FeoBlog
==============

This is a rewrite of <https://github.com/NfNitLoop/fb-rss> in JavaScript, for [Deno].

Run this script periodically to make RSS feeds available in your [FeoBlog] feed.

Installation
------------

1. Install [Deno].
2. `deno install --allow-read --allow-net https://deno.land/x/rss2fb/rss2fb.ts`

Configuration
-------------

Create an `rss2feoblog.toml` in your current directory, following the [sample].

You can create new userIDs on your [FeoBlog] "Log In"/"Change User" page. Make
sure to follow them or add them as users on your FeoBlog server so they have
permission to post.

Then run `rss2fb`, and go refresh your feed. 😊


[Deno]: https://deno.land/
[FeoBlog]: https://github.com/NfNitLoop/feoblog
[sample]: ./rss2feoblog.toml.sample