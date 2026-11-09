/** @typedef {'title'|'find'|'loading'|'play'|'pause'|'over'|'failed'} Screen */
/** @typedef {{type:'hit', lane:number}|{type:'move'|'select'|'difficulty'|'calibrate', delta:number}|{type:'theme', useAsDefault:boolean}|{type:'delete', key:string}|{type:'start'|'pause'|'resume'|'restart'|'title'|'share'|'files'|'find'|'help'}} InputAction */

/** Translate a key (including a touch control's key label) into a game action.
 * Text editing and browser event ownership belong to the input adapter.
 * @param {Screen} screen @param {string} key @param {boolean} shift
 * @returns {InputAction | null}
 */
export function actionForKey(screen, key, shift = false) {
  const k = key.toLowerCase();
  if (screen === "find") return null;
  if (k === "[" || k === "]")
    return { type: "calibrate", delta: k === "]" ? 1 : -1 };
  const confirm = k === " " || k === "enter";
  const direction =
    k === "a" || k === "arrowleft"
      ? -1
      : k === "d" || k === "arrowright"
        ? 1
        : 0;
  if (screen === "pause") {
    if (confirm) return { type: "resume" };
    if (k === "r") return { type: "restart" };
    if (k === "escape") return { type: "title" };
  } else if (screen === "title") {
    if (direction) return { type: "difficulty", delta: direction };
    if (k === "arrowup" || k === "w") return { type: "select", delta: -1 };
    if (k === "arrowdown" || k === "s") return { type: "select", delta: 1 };
    if (confirm) return { type: "start" };
    if (k === "t") return { type: "theme", useAsDefault: shift };
    if (k === "c") return { type: "share" };
    if (k === "o") return { type: "files" };
    if (k === "f") return { type: "find" };
    if (k === "?" || k === "/") return { type: "help" };
    if (["x", "delete", "backspace"].includes(k))
      return { type: "delete", key: k };
  } else if (screen === "over" || screen === "failed") {
    if (confirm) return { type: "restart" };
    if (k === "escape") return { type: "title" };
  } else if (screen === "play") {
    if (k === " " || k === "escape") return { type: "pause" };
    const lane = "jkl".indexOf(k);
    if (k.length === 1 && lane >= 0) return { type: "hit", lane };
    if (direction) return { type: "move", delta: direction };
  }
  return null;
}
