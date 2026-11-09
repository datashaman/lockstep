/** @typedef {import('./song').SongEntry} SongEntry */
/** @param {SongEntry} demo @param {SongEntry} add @param {SongEntry} find */
export function createSongMenu(demo, add, find) {
  const state = {
    /** @type {SongEntry[]} */ library: [],
    /** @type {SongEntry[]} */ server: [],
    /** @type {SongEntry[]} */ entries: [],
    selected: 0,
  };
  return {
    state,
    rebuild() {
      const selected = state.entries[state.selected];
      state.entries = [...state.library, demo, ...state.server, add, find];
      state.selected = Math.max(0, state.entries.indexOf(selected));
    },
    /** @param {number} index */
    select(index) {
      if (
        index < 0 ||
        index >= state.entries.length ||
        index === state.selected
      )
        return false;
      state.selected = index;
      return true;
    },
  };
}
/** Native dialogs own DOM lifecycle; callers own asynchronous operations.
 * @param {Document} document @param {string} title @param {string} message
 */
export function createTrackDialog(document, title, message) {
  const d = document.createElement("dialog"),
    heading = document.createElement("h2"),
    status = document.createElement("p"),
    close = document.createElement("button");
  heading.textContent = title;
  status.textContent = message;
  status.setAttribute("role", "status");
  close.textContent = "Close";
  close.onclick = () => d.close();
  d.onclose = () => d.remove();
  d.append(heading, status, close);
  document.body.append(d);
  d.showModal();
  return { d, status, close };
}
