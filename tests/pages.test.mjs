import assert from "node:assert/strict"
import test from "node:test"
import { demoPage, robots } from "../source/pages.mjs"

test("the entry page only loads its script, which starts the desktop", () => {
  const page = demoPage("/__manager/demo.js")
  assert.match(page, /<script type="module" src="\/__manager\/demo.js"><\/script>/)
  assert.doesNotMatch(page, /<form/)
  assert.doesNotMatch(page, /http-equiv="refresh"/)
})

test("crawl robots are excluded from every demo route", () => {
  assert.equal(robots(), "User-agent: *\nDisallow: /\n")
})
