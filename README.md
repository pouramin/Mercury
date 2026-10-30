# Mercury 3 — TunnelLab benchmark

This repository preserves the source outputs of four coding challenges under the folders `Inception`, `haiku`, and `luna`.

## Challenges

1. Tunnel Coffee — single-file responsive coffee shop landing page.
2. To-do — single-file task manager with localStorage.
3. Snake — HTML canvas browser game.
4. FlowForge Studio — React / TypeScript / Vite workflow studio.

The four unmodified original prompts are available in [`prompts/`](prompts/).

## Saved outputs

There are **11 saved implementations**: 3 coffee shops, 2 to-do apps, 3 Snake games and 3 FlowForge versions.
The `luna/To-DO` output was not uploaded and is intentionally marked unavailable in the showcase.

## Website and demos

The bilingual, responsive showcase is in [`index.html`](index.html), with a light TunnelLab visual style.
The GitHub Actions workflow in `.github/workflows/deploy-pages.yml` copies all 8 single-file applications without editing their generated source. It also builds the 3 FlowForge variants separately and makes them available under `/Mercury/demos/<variant>/flowforge/`.

Expected GitHub Pages custom-domain path: https://pouramin.dev/Mercury/ . Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** if this repository has not been configured for Pages.

Demo links are independently hosted; the main site shows unavailable status when a FlowForge build fails.
No performance scores, speed measurements, token usage, costs or claimed test-pass rates are invented.

## Source protection

The original `Inception/`, `haiku/`, and `luna/` files were not modified for this website. All additions are showcase assets, prompt copies, and the Pages workflow.
