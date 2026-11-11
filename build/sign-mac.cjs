/**
 * Custom macOS signing for electron-builder (`mac.sign`).
 *
 * Signs exactly as electron-builder does by default, with one difference: the
 * Valhalla graph-building CLIs get their own entitlements. electron-builder can
 * only give a per-file entitlement to the main app; every nested binary gets
 * `entitlementsInherit`. Widening that file would hand
 * allow-unsigned-executable-memory to every Electron helper as well, so the
 * per-file options are wrapped here instead.
 *
 * Why the tools need it is in build/entitlements.valhalla-tools.plist. Without
 * it, Download and build downloads the region and then the tile builder is
 * killed by the kernel the moment it parses the first way.
 */
const { join } = require('node:path');

const TOOLS_ENTITLEMENTS = join(__dirname, 'entitlements.valhalla-tools.plist');

/** The CLIs that run LuaJIT. Matched on the bundle-relative path. */
const LUAJIT_TOOLS = /\/Contents\/Resources\/valhalla\/bin\/valhalla_build_(tiles|admins)$/;

function withToolEntitlements(optionsForFile) {
  return (filePath) => {
    const base = optionsForFile === undefined ? {} : optionsForFile(filePath);
    return LUAJIT_TOOLS.test(filePath)
      ? { ...base, entitlements: TOOLS_ENTITLEMENTS }
      : base;
  };
}

module.exports = async function sign(opts) {
  const { signAsync } = await import('@electron/osx-sign');
  await signAsync({ ...opts, optionsForFile: withToolEntitlements(opts.optionsForFile) });
};

module.exports.withToolEntitlements = withToolEntitlements;
module.exports.LUAJIT_TOOLS = LUAJIT_TOOLS;
