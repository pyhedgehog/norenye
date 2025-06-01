import std from 'std';
import os from 'os';

function writeFileSync(fn, data) {
  var fd = std.open(fn, 'w');
  fd.puts(data);
  var res = fd.tell();
  fd.close();
  return res;
}

function readFileSync(fn) {
  return std.loadFile(fn);
}

function statsDateParse(ds) {
  //var dto = /^(?<year>[0-9]+)-(?<month>[0-9]+)-(?<day>[0-9]+) (?<hour>[0-9]+):(?<minutes>[0-9]+)(?::(?<seconds>[0-9]+))?(?:.(?<subseconds>[0-9]+))?(?: (?<tz>.*))?$/.exec(String(ds||''));
  return new Date()
}

function Stats(obj) {
  if(this === undefined)
    throw new TypeError("the Stats constructor must be called with new");
  this.birthtime = this.birthtimeMs = this.blksize = null;
  Object.assign(this, obj);
  this.atimeMs = this.atime;
  this.atime = new Date(this.atimeMs);
  this.ctimeMs = this.ctime;
  this.ctime = new Date(this.ctimeMs);
  this.mtimeMs = this.mtime;
  this.mtime = new Date(this.mtimeMs);
}
Stats.prototype[Symbol.toStringTag] = 'Stats';
Stats.prototype.isBlockDevice = function isBlockDevice(){return Boolean(this.mode&os.S_IFBLK);};
Stats.prototype.isCharacterDevice = function isCharacterDevice(){return Boolean(this.mode&os.S_IFCHR);};
Stats.prototype.isDirectory = function isDirectory(){return Boolean(this.mode&os.S_IFDIR);};
Stats.prototype.isFIFO = function isFIFO(){return Boolean(this.mode&os.S_IFIFO);};
Stats.prototype.isFile = function isFile(){return Boolean(this.mode&os.S_IFREG);};
Stats.prototype.isSocket = function isSocket(){return Boolean(this.mode&os.S_IFSOCK);};
Stats.prototype.isSymbolicLink = function isSymbolicLink(){return Boolean(this.mode&os.S_IFLNK);};

function lstatSync(fn) {
  return new Stats(os.lstat(fn));
}

function statSync(fn) {
  return new Stats(os.stat(fn));
}

export default {
  writeFileSync,
  readFileSync,
  lstatSync,
  statSync,
};
