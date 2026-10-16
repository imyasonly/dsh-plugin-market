/**
 * zip 解压（纯 Node 实现，无第三方依赖）。
 * 用中央目录（End of Central Directory）定位条目，支持 data descriptor；
 * 🔴 路径穿越防护：拒绝绝对路径与 `..` 上跳（zip-slip 攻击），拒绝盘符与设备名。
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  method: number;
  crc32: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEocd(buf: Buffer): number {
  // EOCD 最小 22 字节，注释最长 65535：从尾部向前扫
  const start = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('zip 解析失败：找不到中央目录（unexpected end of file）');
}

function readEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let pos = cenOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) throw new Error('zip 解析失败：中央目录损坏');
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    entries.push({ name, compressedSize, uncompressedSize, localHeaderOffset, method, crc32: crc });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateRaw(data: Buffer, uncompressedSize: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zlib = require('node:zlib') as typeof import('node:zlib');
    zlib.inflateRaw(data, (err, out) => {
      if (err) reject(err);
      else resolvePromise(out.subarray(0, Math.max(0, uncompressedSize)));
    });
  });
}

/** 解压到目标目录；返回写入的相对路径列表（目录条目不写入文件） */
export async function unzipToDir(zipPath: string, destDir: string): Promise<string[]> {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const buf = readFileSync(zipPath);
  const entries = readEntries(buf);
  const written: string[] = [];
  for (const entry of entries) {
    // 路径穿越防护：zip-slip
    if (entry.name.includes('..')) throw new Error(`拒绝路径穿越条目: ${entry.name}`);
    if (/^[a-zA-Z]:/.test(entry.name) || entry.name.startsWith('/')) {
      throw new Error(`拒绝绝对路径条目: ${entry.name}`);
    }
    if (entry.name.startsWith('__MACOSX') || entry.name.includes('/__MACOSX') || basename(entry.name).startsWith('._')) continue;
    if (entry.name.endsWith('/')) continue; // 目录条目：mkdir 随文件创建

    const lfh = entry.localHeaderOffset;
    if (lfh + 30 > buf.length || buf.readUInt32LE(lfh) !== LFH_SIG) throw new Error(`zip 解析失败：本地文件头损坏 (${entry.name})`);
    const lfhNameLen = buf.readUInt16LE(lfh + 26);
    const lfhExtraLen = buf.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + lfhNameLen + lfhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
    if (raw.length < entry.compressedSize) throw new Error(`zip 解析失败：数据段不完整 (${entry.name})`);

    let out: Buffer;
    if (entry.method === 0) {
      out = raw.subarray(0, entry.uncompressedSize);
    } else if (entry.method === 8) {
      out = await inflateRaw(raw, entry.uncompressedSize);
    } else {
      throw new Error(`不支持的压缩方式 (${entry.name}, method=${entry.method})`);
    }

    const target = join(destDir, entry.name);
    // 双保险：解析后的绝对路径必须仍在 destDir 内
    if (!resolve(target).startsWith(resolve(destDir))) throw new Error(`拒绝越界写入: ${entry.name}`);
    mkdirSync(dirname(target), { recursive: true });
    await pipeline(Readable.from(out), createWriteStream(target));
    written.push(entry.name);
  }
  return written;
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}
