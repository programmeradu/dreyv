// Edge runtime path stub
function join(...args) {
  return args.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function basename(p, ext) {
  const base = String(p || "").split(/[/\\]/).pop() || "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

function dirname(p) {
  const parts = String(p || "").split(/[/\\]/);
  parts.pop();
  return parts.join("/") || ".";
}

function extname(p) {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx < 0 ? "" : base.slice(idx);
}

function relative(from, to) {
  return String(to || "");
}

function resolve(...args) {
  return join(...args);
}

const stub = {
  join,
  basename,
  dirname,
  extname,
  relative,
  resolve,
  sep: "/",
  delimiter: ":",
};
stub.default = stub;
module.exports = stub;
