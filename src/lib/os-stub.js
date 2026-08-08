// Edge runtime OS stub
function tmpdir() {
  return "/tmp";
}
function platform() {
  return "linux";
}
function type() {
  return "Linux";
}
function homedir() {
  return "/tmp";
}
function endianness() {
  return "LE";
}
function release() {
  return "1.0.0";
}
function arch() {
  return "x64";
}

const stub = {
  tmpdir,
  platform,
  type,
  homedir,
  endianness,
  release,
  arch,
  EOL: "\n",
};
stub.default = stub;
module.exports = stub;
