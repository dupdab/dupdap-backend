# Releasing

## Versioning

- This project follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
- The API version and the npm `package.json` `version` are released together;
  bump both in the same commit.

## Release process

1. Update `CHANGELOG.md` under `[Unreleased]`: move entries into a new
   `## [X.Y.Z] - YYYY-MM-DD` section (Added / Changed / Fixed).
2. Bump `version` in `package.json` (`npm version [major|minor|patch] --no-git-tag-version`).
3. Commit: `chore(release): vX.Y.Z`.
4. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Create a GitHub Release from the tag; paste the `CHANGELOG.md` section as
   the release notes.
6. Verify: `npm run build` passes and Swagger docs at `/docs` show the new version.
