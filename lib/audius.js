import {
  importBytes,
  isImportDuration,
  checkImportDuration,
} from "./audio-import.js";
/** @typedef {import('./song').AudiusTrack} AudiusTrack */
const API = "https://api.audius.co/v1/tracks",
  APP = "app_name=lockstep";
/** @param {string | undefined} value */
export function audiusURL(value) {
  try {
    if (!value) return null;
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "audius.co" &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)
      ? url.origin + url.pathname.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}
/** @param {(url:string)=>Promise<Response>} request */
export function createAudiusClient(request) {
  return {
    /** @param {string} query @returns {Promise<AudiusTrack[]>} */
    async search(query) {
      const q = query.trim();
      const response = await request(
        q
          ? `${API}/search?query=${encodeURIComponent(q)}&limit=50&${APP}`
          : `${API}/trending?limit=50&${APP}`,
      );
      if (!response.ok) throw new Error(`Audius said ${response.status}`);
      const { data } = await response.json();
      return data.filter(
        (/** @type {AudiusTrack} */ track) =>
          track.is_streamable &&
          track.access?.stream &&
          isImportDuration(track.duration),
      );
    },
    /** @param {string} value @returns {Promise<AudiusTrack>} */
    async resolve(value) {
      const url = audiusURL(value);
      if (!url) throw new Error("This is not an Audius track link.");
      const response = await request(
        `https://api.audius.co/v1/resolve?url=${encodeURIComponent(url)}&${APP}`,
      );
      if (!response.ok)
        throw new Error(
          `Audius could not find this track (${response.status}).`,
        );
      const { data } = await response.json(),
        track = Array.isArray(data) ? data[0] : data;
      if (
        !track ||
        typeof track.id !== "string" ||
        !/^[a-zA-Z0-9]+$/.test(track.id) ||
        !track.title ||
        !track.user?.name ||
        !audiusURL(`https://audius.co${track.permalink}`)
      )
        throw new Error("This link does not resolve to a track.");
      if (!track.is_streamable || !track.access?.stream)
        throw new Error("This track is no longer available to stream.");
      checkImportDuration(track.duration);
      return track;
    },
    /** @param {string} id */
    download(id) {
      return request(`${API}/${encodeURIComponent(id)}/stream?${APP}`).then(
        importBytes,
      );
    },
    /** @param {AudiusTrack} track */
    previewURL(track) {
      return `${API}/${track.id}/stream?${APP}#t=${track.preview_start_seconds ?? Math.round(Math.min(30, track.duration * 0.3))}`;
    },
  };
}
/** Search results have one owner; late requests cannot replace newer results.
 * @param {ReturnType<typeof createAudiusClient>} client @param {()=>void} onResults
 */
export function createTrackSearch(client, onResults) {
  const state = {
    q: "",
    /** @type {AudiusTrack[]} */ list: [],
    sel: 0,
    busy: false,
    err: "",
  };
  let requestId = 0;
  return {
    state,
    async search() {
      const id = ++requestId;
      state.busy = true;
      state.err = "";
      try {
        const list = await client.search(state.q);
        if (id !== requestId) return;
        state.list = list;
        state.sel = 0;
        state.busy = false;
        onResults();
      } catch (error) {
        if (id === requestId) {
          state.busy = false;
          state.err = error instanceof Error ? error.message : String(error);
        }
      }
    },
  };
}
