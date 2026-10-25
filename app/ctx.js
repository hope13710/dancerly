// Shared app context. main.js fills it in at startup; views read from it.
export const ctx = {
  state: null,
  view: null,
  navigate: () => {},
  setCrumbs: () => {},
  refreshNav: () => {},
  refreshUnread: () => {},
  startAction: () => {},
  route: () => {}
};
