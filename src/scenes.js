// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Super live only exists as an explicit action: a scene author places it on
// purpose ("the cat left the garden at night: start super live"). The
// integration never starts it by itself, and it is not a device feature, so
// no voice assistant or "turn everything on" can start it by mistake: it
// drains the battery in a few hours.
//
// The ring, vibrate and "ask for a position" commands are device features
// (buttons): the core's own "control a device" scene action already reaches
// them.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  /** @param {import('./service.js').WeenectService} service */
  async activate_super_live(service, { fields }) {
    await service.startSuperLive(fields.tracker);
    return undefined;
  },
};
