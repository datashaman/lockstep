/** Audio lifecycle for one pause; the caller owns screens, snapshots and errors.
 * @template T
 * @param {Pick<AudioContext,'suspend'|'resume'>} context
 * @param {T} image
 * @param {{now:()=>number,hidden:()=>boolean,current:()=>boolean}} clock
 */
export function createPauseSession(context, image, clock) {
  const state = {
    image,
    at: clock.now(),
    deadline: 0,
    busy: false,
    ready: context.suspend(),
    countdown() {
      if (!state.busy && !state.deadline && !clock.hidden())
        state.deadline = clock.now() + 3;
    },
    /** @returns {Promise<number | null>} Seconds paused, or null if still paused/stale. */
    async resume() {
      if (state.busy) return null;
      state.busy = true;
      try {
        await state.ready;
        if (!clock.current()) return null;
        await context.resume();
        if (!clock.current()) return null;
        if (clock.hidden()) {
          await context.suspend();
          state.busy = false;
          state.deadline = 0;
          return null;
        }
        return clock.now() - state.at;
      } catch (error) {
        state.busy = false;
        state.deadline = 0;
        throw error;
      }
    },
  };
  return state;
}
