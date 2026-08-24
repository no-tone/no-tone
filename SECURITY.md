# Security Policy

This repository is a GitHub profile README and the generator that writes it.
There is no service here, no deployment, and no user data - so this policy is
short, and most of it is a redirect.

## If you found something in the site, the API, or the SSH CV

Report it against **[no-tone/tonil](https://github.com/no-tone/tonil)**, which
is where that code lives, and follow
[its policy](https://github.com/no-tone/tonil/blob/main/docs/SECURITY.md).
`tone.rip`, `api.tone.rip`, `dash.tone.rip` and `ssh cv.tone.rip` are all out
of scope here.

## What is in scope here

Two things, and they are the same thing twice: **the refresh workflow runs code
from this repository, as a job holding a token that can write to it.**

- `.github/workflows/refresh.yml` - it has `contents: write` and is given
  `STATS_TOKEN`, a personal access token. Anything that could make that job run
  code it was not meant to, or leak that token into a log, an artifact, or a
  commit, is worth reporting.
- `scripts/**` - the generator. It fetches from `api.github.com` and writes
  files that are then committed automatically. Injection through an API
  response it does not validate, or a path it writes that it should not, counts.

Also in scope, though lower stakes: the generated SVGs are built from strings
that come off the GitHub API - repository names, language names. They are
XML-escaped in `scripts/lib/card.ts`. If you can get markup through that, say
so.

Explicitly **not** in scope: the numbers being wrong. That is a bug, not a
vulnerability - open an issue.

## Reporting

Either route, both private:

1. **GitHub Security Advisory** (preferred): repo → Security → Report a
   vulnerability.
2. **Email**: `m@tone.rip`.

Single-maintainer project, no bug bounty. You will get an acknowledgment within
a week; if you hear nothing in two, email the address above - the advisory
route can bury things.

## Supported versions

`main` only. There are no releases and no branches to backport to: whatever is
on `main` is what renders on the profile.
