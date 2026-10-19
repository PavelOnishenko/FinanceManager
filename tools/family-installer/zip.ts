import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { forbiddenName } from "./toolchain";

export async function distributionFiles(root: string, relative = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    assert(!forbiddenName(entry.name), `Forbidden distribution file: ${entry.name}`);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...await distributionFiles(root, name));
    else {
      assert((await stat(path.join(root, name))).isFile(), `Not a regular file: ${name}`);
      files.push(name);
    }
  }
  return files.sort();
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Portable ZIP writer: no global zip, PowerShell, Python, or npm dependency.
// Fixed timestamps and ordered paths keep identical inputs byte-for-byte stable.
export function writeZip(root: string, files: string[], output: string): void {
  assert(files.length <= 65535, "ZIP64 is not supported");
  const handle = openSync(output, "wx");
  let offset = 0;
  const directory: Buffer[] = [];
  try {
    for (const name of files) {
      const bytes = readFileSync(path.join(root, name));
      const compressed = deflateRawSync(bytes);
      const filename = Buffer.from(name);
      assert(bytes.length < 0xffffffff && offset + bytes.length + filename.length + 30 < 0xffffffff, "ZIP64 is not supported");
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x800, 6);
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(33, 12); // 1980-01-01
      header.writeUInt32LE(crc32(bytes), 14);
      header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(bytes.length, 22);
      header.writeUInt16LE(filename.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(20, 4);
      header.copy(central, 6, 4, 30);
      central.writeUInt32LE(offset, 42);
      directory.push(Buffer.concat([central, filename]));
      for (const part of [header, filename, compressed]) {
        let written = 0;
        while (written < part.length)
          written += writeSync(handle, part, written);
        offset += part.length;
      }
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    writeSync(handle, central);
    writeSync(handle, end);
  } finally {
    closeSync(handle);
  }
}
