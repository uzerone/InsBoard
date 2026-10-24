<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/app-icon-dark.png">
    <img src="apps/web/public/app-icon-light.png" width="128" alt="InsBoard app icon">
  </picture>
</p>

# InsBoard

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&amp;logoColor=white" alt="macOS Apple Silicon">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

An image generation canvas for macOS and the web. Create from a prompt, work with references, and connect ideas through generation nodes.

InsBoard connects to an OpenAI-compatible image API. Projects, generated images, and API settings are stored on your computer.

## Features

- **Generate and edit** — use text prompts and selected reference images in one form.
- **Model selection** — choose Image 2, 2.5 Flare, 2.5 Sunburst, or a custom model for each generation. Availability depends on your API provider.
- **Connected workflows** — pass images between generation nodes, retry failed work, or cancel a running workflow.
- **Infinite canvas** — pan, zoom, resize images and nodes, snap to a grid, and undo or redo edits.
- **Portable projects** — save an `.idb` file with its images and reopen it on another computer. API keys are excluded.

## Getting started

1. Open **Settings** and enter your image API address and key.
2. Choose a model, enter a prompt, and select **Generate image**.
3. To use references, select images on the canvas. They appear directly in the generation form.

Use **Save** to export your project as an `.idb` file and **Open** to continue working on a saved project.

## Run locally

Requires Node.js 24 and pnpm 9.14.2.

```sh
pnpm install
pnpm dev
```

Open [localhost:5173](http://localhost:5173).

## Build the macOS app

Requires an Apple Silicon Mac with Xcode installed.

```sh
pnpm desktop:package
```

The build produces `release/mac-arm64/InsBoard.app`. Copy it to `/Applications` to use it as a desktop app.

---

Released under the [MIT License](LICENSE). Copyright © 2026 [uzerone](https://github.com/uzerone).
