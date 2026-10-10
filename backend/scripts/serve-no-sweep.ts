/**
 * The API without the background ERC-8004 sweep, for pointing at a local anvil fork.
 *
 * A fork fetches state lazily from its upstream, and a full registry sweep (thousands of
 * `ownerOf`/`tokenURI` reads) is enough to stall it, which then times out every other
 * read, including the tracking ones /me needs. Used by `video/scripts/capture-launch.mjs`.
 * Agent pages still resolve through the on-chain FuguRegistry tier.
 */
import { createServer } from "node:http";
import { buildServer, createRequestListener } from "../src/index.js";

const port = Number(process.env.PORT ?? 8799);
const built = buildServer();
createServer(createRequestListener(built.app)).listen(port, () => console.log(`[fugugent] api (no sweep) on :${port}`));
