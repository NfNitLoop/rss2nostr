// deno-lint-ignore-file prefer-const
import { assertEquals } from "https://deno.land/std@0.135.0/testing/asserts.ts";

import { htmlToMarkdown } from "../markdown.ts";


Deno.test("Strange HTML-to-markdown behavior", () => {
    // Some RSS feeds have HTML with weird spacing like this:
    // (Possibly because they use CMSes to write HTML and not humans)
    let input = `Foo<em> <a href="#target">Bar</a> </em>baz`

    let output = htmlToMarkdown(input)

    // I guess the spaces are getting trimmed because they're inside of an <em> but that results in this:
    let actual = "Foo_[Bar](#target)_baz"
    assertEquals(output, actual)


    // But what I'd expect is: "Foo _[Bar](#target)_ baz"
})