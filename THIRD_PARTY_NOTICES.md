# Third-party notices

## macroxue/2048-ai

This project vendors and builds the small C++ `2048` AI from:

- Repository: <https://github.com/macroxue/2048-ai>
- Pinned commit: `fee3359d06cda82cb20a36ce312b06209ca1baad`
- Vendored source: `vendor/2048-ai/`
- License: **GNU General Public License v3.0** (`vendor/2048-ai/LICENSE`)
- Copyright: belongs to the upstream authors as stated in the upstream source
  and repository.

The upstream Expectimax algorithm, evaluation, game rules, and Tuple10/Tuple11
lookup-table format are unchanged. The local compatibility patch in
`2048.cc` changes HTTP response line endings to CRLF so browser/Node `fetch`
accepts the response; HTTP/1.1 keep-alive remains enabled.

The project does not distribute the generated lookup tables
(`vendor/2048-ai/tables/`, several GB). They are generated locally from the
vendored upstream source using the documented first-start command. The complete
source used to build the AI is included in `vendor/2048-ai/`, together with its
Dockerfile and license.

## Runtime tooling

- Node.js is used as the local page server and test runtime. It is not bundled.
- Docker Engine / Docker Desktop is used to build and run the AI service. It is
  not bundled.
- Microsoft Edge is used only for optional Headless browser tests and asset
  capture. It is not bundled.
- The project has no npm dependencies and no `node_modules`.

## Project license

Because the distribution includes and builds GPL-3.0 code, this project is
distributed under the **GNU General Public License v3.0**. See the root
`LICENSE` file and `vendor/2048-ai/LICENSE`.

The project is provided without warranty, to the extent permitted by law.
