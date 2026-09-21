# Renderline — Next.js Plan-to-3D Studio

A browser-native floor-plan analysis and interactive 3D shell generator built with **Next.js 16.3.5**, React 19, TypeScript, PDF.js and Three.js.

## Features

- PDF, PNG, JPG and WEBP plan input
- Browser-local processing; plans are not uploaded to an application backend
- Automatic main-plan crop suggestion and wall-line extraction
- Editable wall overlay: include/exclude, manually add and crop/re-detect
- User-controlled plan width, wall height and wall thickness
- Interactive Three.js scene with top and perspective views
- Warm, light and dark material directions
- PNG render capture
- Static export suitable for GitHub Pages

## Development

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm audit
```

## Product boundary

The current version creates a deterministic architectural wall shell. Photorealistic furnishing remains a separate image-generation-provider integration so the interface does not imply unimplemented AI rendering.
