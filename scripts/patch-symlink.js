const fs = require('fs');
const path = require('path');

function copySync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((child) => {
      copySync(path.join(src, child), path.join(dest, child));
    });
  } else {
    // If destination already exists, delete it first to prevent EEXIST
    if (fs.existsSync(dest)) {
      try { fs.unlinkSync(dest); } catch (e) {}
    }
    fs.copyFileSync(src, dest);
  }
}

const originalSymlinkSync = fs.symlinkSync;
fs.symlinkSync = function(target, filepath, type) {
  try {
    // Try original symlink first (in case Developer Mode is enabled or it works)
    return originalSymlinkSync(target, filepath, type);
  } catch (err) {
    if (err.code === 'EPERM') {
      const resolvedTarget = path.resolve(path.dirname(filepath), target);
      // Fallback to recursive copy
      copySync(resolvedTarget, filepath);
      return;
    }
    throw err;
  }
};

const originalSymlink = fs.symlink;
fs.symlink = function(target, filepath, type, callback) {
  const cb = typeof type === 'function' ? type : callback;
  const actualType = typeof type === 'string' ? type : undefined;
  
  // Try original symlink first
  originalSymlink(target, filepath, actualType, (err) => {
    if (err && err.code === 'EPERM') {
      try {
        const resolvedTarget = path.resolve(path.dirname(filepath), target);
        copySync(resolvedTarget, filepath);
        if (cb) cb(null);
      } catch (copyErr) {
        if (cb) cb(copyErr);
      }
      return;
    }
    if (cb) cb(err);
  });
};
