// deno-lint-ignore-file prefer-const
import { assertEquals } from "https://deno.land/std@0.135.0/testing/asserts.ts";

import { htmlToMarkdown } from "../markdown.ts";


Deno.test("spaces inside styles", () => {
    // Some RSS feeds have HTML with weird spacing like this:
    // (Possibly because they use CMSes to write HTML and not humans)
    let input = `Foo<em> <a href="#target">Bar</a> </em>baz`
    let output = htmlToMarkdown(input)

    // Make sure this doesn't happen again:
    assertEquals(output, "Foo _[Bar](#target)_ baz")
})