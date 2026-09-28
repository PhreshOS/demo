/** The entry page: its script starts the desktop and shows its progress. */
export function demoPage(scriptPath) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PhreshOS demo</title>
  <style>html,body{height:100%;margin:0}</style>
</head>
<body><div id="demo" style="height:100%"></div><script type="module" src="${scriptPath}"></script></body>
</html>`
}

export function robots() {
  return "User-agent: *\nDisallow: /\n"
}

export function unavailable(message) {
  return page("Demo unavailable", `<main><h1>Demo unavailable</h1><p>${escapeHtml(message)}</p></main>`)
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#111;color:#fff;font:16px system-ui,sans-serif}main{text-align:center;padding:2rem}h1{font-size:1.25rem}p{opacity:.7}</style>
</head>
<body>${body}</body>
</html>`
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
