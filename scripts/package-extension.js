const fs = require("fs");
const path = require("path");
const { deflateRawSync } = require("zlib");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function extensionFiles(root, directory = "src") {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter(entry => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const relative = `${directory}/${entry.name}`;
      return entry.isDirectory() ? extensionFiles(root, relative) : entry.isFile() ? [relative] : [];
    });
}

// A standard ZIP, using Node's built-in compression so every build environment can package it.
function packageExtension(root, destination) {
  const localEntries = [], centralEntries = [];
  const names = ["manifest.json", ...extensionFiles(root)];
  let offset = 0;
  for (const relative of names) {
    const name = Buffer.from(relative);
    const data = fs.readFileSync(path.join(root, relative));
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames.
    local.writeUInt16LE(8, 8); // Deflate.
    local.writeUInt16LE(0x5021, 12); // Stable timestamp: 2020-01-01.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localEntries.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x5021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...localEntries, centralDirectory, end]));
}
module.exports = { packageExtension };
