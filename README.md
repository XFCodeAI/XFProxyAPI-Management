# XFProxyAPI Management

React management panel for XFProxyAPI.

## Development

```bash
pnpm install
pnpm dev
```

The production build uses `/management-assets/` as the asset base path because XFProxyAPI serves bundled panel assets from that route.

## Build

```bash
pnpm build
pnpm package
```

`pnpm package` creates:

```text
management-panel.zip
```

The zip root contains:

```text
index.html
assets/
xf.png
```

## XFProxyAPI local integration

Build this panel, then run XFProxyAPI with `MANAGEMENT_STATIC_PATH` pointing at the generated HTML file:

```bash
MANAGEMENT_STATIC_PATH=/absolute/path/to/XFProxyAPI-Management/dist/index.html go run ./cmd/server
```

## Release artifact

GitHub Actions uses pnpm to build and upload `management-panel.zip` as a workflow artifact on push, pull request, and manual runs.

When a GitHub Release is published, the same workflow uploads `management-panel.zip` to that release. XFProxyAPI can consume that asset through its remote management panel updater.
