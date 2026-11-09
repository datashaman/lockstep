import assert from "node:assert/strict";
import { createSongMenu } from "./lib/song-menu.js";
import {
  createAudiusClient,
  createTrackSearch,
  audiusURL,
} from "./lib/audius.js";
const demo = { title: "demo" },
  add = { title: "add" },
  find = { title: "find" },
  entry = { title: "saved", lib: "id" };
const menu = createSongMenu(demo, add, find);
menu.rebuild();
assert.deepEqual(menu.state.entries, [demo, add, find]);
menu.state.library = [entry];
menu.rebuild();
assert.equal(menu.state.entries[menu.state.selected], demo);
assert.equal(menu.select(0), true);
menu.state.server = [{ title: "server" }];
menu.rebuild();
assert.equal(menu.state.entries[menu.state.selected], entry);
assert.equal(menu.select(99), false);
menu.state.library = [];
menu.rebuild();
assert.equal(menu.state.selected, 0);
const pending = [];
let previews = 0;
const search = createTrackSearch(
  { search: () => new Promise((resolve) => pending.push(resolve)) },
  () => previews++,
);
search.state.q = "old";
const old = search.search();
search.state.q = "new";
const latest = search.search();
pending[1]([{ id: "new" }]);
await latest;
pending[0]([{ id: "old" }]);
await old;
assert.equal(search.state.list[0].id, "new");
assert.equal(previews, 1);
assert.equal(search.state.busy, false);
const track = {
  id: "abc",
  title: "Song",
  user: { name: "Artist" },
  permalink: "/artist/song",
  duration: 120,
  is_streamable: true,
  access: { stream: true },
};
const client = createAudiusClient(async () => ({
  ok: true,
  json: async () => ({ data: [track, { ...track, duration: 601 }] }),
}));
assert.deepEqual(await client.search("test"), [track]);
assert.equal(audiusURL("https://audius.co.evil/a/b"), null);
console.log(
  "ok: stable catalog selection, invalid selection, latest-only search results and stream filtering",
);

for (const duration of [1, 29, 30, 600, 0, .99, 600.01, Infinity, NaN, "30", null]) {
  const candidate = { ...track, duration };
  const client = createAudiusClient(async () => ({
    ok: true, json: async () => ({ data: [candidate] }),
  }));
  const valid = typeof duration === 'number' && Number.isFinite(duration) && duration >= 1 && duration <= 600;
  assert.deepEqual(await client.search('test'), valid ? [candidate] : []);
  if (valid) assert.deepEqual(await client.resolve('https://audius.co/artist/song'), candidate);
  else await assert.rejects(client.resolve('https://audius.co/artist/song'), /1 second and 10 minutes/);
}
