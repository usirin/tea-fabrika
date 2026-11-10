// Today's app. Electron preloads this synchronous hook before importing the app entry point.
function install(input) {
  const { app, id, pid, write, now = Date.now } = input;
  const windows = new Map();
  const live = new Map();
  let complete = false;
  const report = () =>
    structuredClone({
      version: 1,
      id,
      pid,
      installed: true,
      complete,
      windows: [...windows.values()],
    });
  const entry = (window) => {
    if (!windows.has(window.id)) {
      windows.set(window.id, { id: window.id, closed: false, records: [] });
    }

    return windows.get(window.id);
  };

  // Focus can arrive before the creation event. Keep that evidence in the same window history.
  app.on("browser-window-focus", (_event, window) => {
    entry(window).records.push({ _tag: "focus", at: now() });
  });
  app.on("browser-window-created", (_event, window) => {
    const history = entry(window);
    let ignoresMouse = false;
    let settingUp = true;
    let placing = false;
    const opacity = window.setOpacity;
    const mouse = window.setIgnoreMouseEvents;

    window.setOpacity = function (...args) {
      try {
        const result = Reflect.apply(opacity, this, args);
        const value = this.getOpacity();
        history.records.push({
          _tag: "opacity",
          at: now(),
          ok: true,
          setup: settingUp,
          requested: args[0],
          value,
        });
        return result;
      } catch (error) {
        history.records.push({
          _tag: "opacity",
          at: now(),
          ok: false,
          setup: settingUp,
          requested: args[0],
          error: String(error),
        });
        throw error;
      }
    };
    window.setIgnoreMouseEvents = function (...args) {
      try {
        const result = Reflect.apply(mouse, this, args);
        ignoresMouse = args[0];
        history.records.push({
          _tag: "mouse",
          at: now(),
          ok: true,
          setup: settingUp,
          requested: args[0],
          value: ignoresMouse,
        });
        return result;
      } catch (error) {
        history.records.push({
          _tag: "mouse",
          at: now(),
          ok: false,
          setup: settingUp,
          requested: args[0],
          error: String(error),
        });
        throw error;
      }
    };

    const place = () => {
      placing = true;

      try {
        const area = { ...input.screen.getPrimaryDisplay().workArea };
        const bounds = window.getBounds();

        if (bounds.x !== area.x || bounds.y !== area.y) {
          window.setPosition(area.x, area.y);
        }

        return {
          opacity: window.getOpacity(),
          ignoresMouse,
          focused: window.isFocused(),
          bounds: window.getBounds(),
          area,
        };
      } finally {
        placing = false;
      }
    };
    const settle = () => {
      if (settingUp || placing || history.closed || window.isDestroyed()) {
        return;
      }

      try {
        const state = place();
        history.records.push({ _tag: "bounds", at: now(), ok: true, state });
      } catch (error) {
        history.records.push({ _tag: "bounds", at: now(), ok: false, error: String(error) });
      }
    };
    live.set(window.id, settle);
    window.on("move", settle);
    window.on("resize", settle);
    window.on("closed", () => {
      history.closed = true;
      history.records.push({ _tag: "closed", at: now() });
      live.delete(window.id);
      write(report());
    });

    try {
      window.setOpacity(0);

      if (window.getOpacity() !== 0) {
        throw new Error("window opacity did not become zero");
      }

      window.setIgnoreMouseEvents(true);
      watchDisplays();
      const state = place();
      history.records.push({ _tag: "setup", at: now(), ok: true, state });
    } catch (error) {
      history.records.push({ _tag: "setup", at: now(), ok: false, error: String(error) });
      throw error;
    } finally {
      settingUp = false;
    }
  });

  let watchingDisplays = false;
  function watchDisplays() {
    if (watchingDisplays || !app.isReady()) {
      return;
    }

    watchingDisplays = true;
    const settle = () => {
      for (const update of live.values()) {
        update();
      }
    };

    for (const event of ["display-metrics-changed", "display-added", "display-removed"]) {
      input.screen.on(event, settle);
    }
  }

  // Electron's screen module is lazy and cannot be loaded before ready.
  if (app.isReady()) {
    watchDisplays();
  } else {
    app.once("ready", watchDisplays);
  }

  app.on("quit", () => {
    complete = true;
    write(report());
  });
  return { report };
}

module.exports = { install };

if (process.versions.electron && process.type === "browser") {
  const electron = require("electron");
  const { writeFileSync } = require("node:fs");
  const path = process.env.FABRIKA_E2E_REPORT;
  globalThis.__fabrikaE2E = install({
    app: electron.app,
    get screen() {
      return electron.screen;
    },
    id: process.env.FABRIKA_E2E_ID ?? `second-copy-${process.pid}`,
    pid: process.pid,
    write(report) {
      // The single-instance probe also loads the hook, but needs no report of its own.
      if (path) {
        writeFileSync(path, JSON.stringify(report));
      }
    },
  });
}
