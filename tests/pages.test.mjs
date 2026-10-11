import assert from "node:assert/strict"
import test from "node:test"
import { demoPage, robots } from "../source/pages.mjs"

test("the entry page only loads its script, which starts the desktop", () => {
  const page = demoPage("/__manager/demo.js")
  assert.match(page, /<script type="module" src="\/__manager\/demo.js"><\/script>/)
  assert.doesNotMatch(page, /<form/)
  assert.doesNotMatch(page, /http-equiv="refresh"/)
})

test("the entry page's views are counted at stats.phreshos.com, on the demo's own domain only", () => {
  const page = demoPage("/__manager/demo.js")
  assert.match(page, /<script defer src="https:\/\/stats\.phreshos\.com\/script\.js" data-website-id="[0-9a-f-]{36}" data-domains="demo\.phreshos\.com"><\/script>/)
})

test("crawl robots are excluded from every demo route", () => {
  assert.equal(robots(), "User-agent: *\nDisallow: /\n")
})
