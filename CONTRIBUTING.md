# Contributing

This repository owns the public PhreshOS demo: the disposable desktop image,
the session manager, and its routing. Changes belong here when they keep each
visitor's machine isolated, short-lived, and identical to a real installation.

## Development

```sh
bun install --frozen-lockfile
npm run verify
```

## Changes

- The desktop image installs PhreshOS through the public CLI, as a person
  would; it never copies a System from source.
- Nothing about a particular server belongs in the repository: addresses,
  credentials, and deployment notes stay with whoever deploys it.
