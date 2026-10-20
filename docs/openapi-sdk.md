# OpenAPI SDK Generation

The OpenAPI JSON spec is exported as a CI build artifact (`openapi.json`)
and attached to version-tagged GitHub releases.

## Export locally

```bash
npm run export:openapi
```

This boots the Nest application, builds the Swagger document
(the same document served at `/docs-json`), and writes `openapi.json`.

## Generate a TypeScript client

```bash
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json \
  -g typescript-axios \
  -o sdk/typescript
```

## Generate a Python client

```bash
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json \
  -g python \
  -o sdk/python
```
