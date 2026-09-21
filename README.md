# Renderline — Next.js Plan-to-3D Studio

A browser-native floor-plan analysis, editable 3D model and AI architectural-rendering application built with **Next.js 16.3.5**, React 19, TypeScript, PDF.js, Three.js and FAL.

## Features

- PDF, PNG, JPG and WEBP plan input
- Browser-local PDF/image rasterisation and plan analysis
- Probable wall detection with editable inclusion/exclusion
- Manual wall correction and crop-based re-analysis
- Plan width, wall height and wall thickness controls
- Click-to-place doors, windows, sofas, beds, tables and cabinets
- Object rotation/removal controls and live Three.js furniture geometry
- Interactive Three.js scene with orbit, top and perspective controls
- Camera-view image export
- Secure server-side FAL image-to-image photorealistic rendering
- Functional four-step workflow navigation

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Photorealistic rendering

Create a FAL key at <https://fal.ai/dashboard/keys>, then add it as the server-only environment variable `FAL_KEY` in Vercel. The key is read exclusively by `/api/render` and is never exposed to the browser.

## Quality gates

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm audit
```

## Product boundary

The editable model is generated deterministically from the reviewed plan geometry. The photorealistic output is AI image-to-image rendering conditioned on the approved 3D camera view; it should be visually reviewed and is not a substitute for CAD/BIM construction documentation.
