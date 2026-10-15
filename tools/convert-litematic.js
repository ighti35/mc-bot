// mc-bot/tools/convert-litematic.js — 把 .litematic 图纸转成 bot 可建的坐标 JSON
// 用法: node tools/convert-litematic.js <input.litematic> <out.json> [name]
// 读取 litematica 格式(该格式是 gzip 压缩的 NBT)，还原每个非空气方块坐标 → data/schematics/*.json
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parse } = require('prismarine-nbt');

async function convertLitematic(inputFile, outFile, name) {
  const buf = fs.readFileSync(inputFile);
  const nbt = await parse(zlib.gunzipSync(buf));
  const root = nbt.parsed.value;

  const regionsTag = root.Regions;
  if (!regionsTag || !regionsTag.value) throw new Error('不是有效的 .litematic（缺 Regions）');
  const regions = regionsTag.value;
  const keys = Object.keys(regions);

  // 可能有多块 region，全部合并
  const allBlocks = [];
  const paletteInfo = [];
  for (const rk of keys) {
    const R = regions[rk].value;
    const S = R.Size.value;
    // litematica 尺寸可能带符号（负数表示 region 相对原点的偏移方向），实际尺寸取绝对值
    const sx = Math.abs(S.x.value), sy = Math.abs(S.y.value), sz = Math.abs(S.z.value);
    // palette 每项可能是简单方块（只有 Name），也可能带 Properties（楼梯朝向/原木轴/门半扇等）
    // 生成两种形式：name = 方块 id；setblock = 带属性后缀的完整 /setblock 块串，忠实保留朝向
    const palette = R.BlockStatePalette.value.value.map((p) => {
      const name = p.Name.value;
      if (!p.Properties || !p.Properties.value) return { name, setblock: name };
      const props = Object.entries(p.Properties.value)
        .map(([k, v]) => `${k}=${v.value}`)
        .join(',');
      return { name, setblock: `${name}[${props}]` };
    });
    const LONG_OBJ = R.BlockStates.value;
    const numLongs = Object.keys(LONG_OBJ).length;
    const longs = [];
    for (let i = 0; i < numLongs; i++) {
      const [hi, lo] = LONG_OBJ[i];
      longs.push((BigInt(hi) << 32n) | BigInt(lo));
    }
    const bits = Math.ceil(Math.log2(Math.max(2, palette.length)));
    const perLong = Math.floor(64 / bits);
    // 注意：文件里声明的 Size 有时 > 实际数据量（BlockStates long 数 * perLong），
    // 用后者做 total 才不会越界漏块。
    const total = longs.length * perLong;

    for (let i = 0; i < total; i++) {
      const longIdx = Math.floor(i / perLong);
      const b = (i % perLong) * bits;
      let idx = 0;
      const lv = longs[longIdx];
      if (lv !== undefined) idx = Number((lv >> BigInt(b)) & BigInt((1n << BigInt(bits)) - 1n));
      const entry = palette[idx] || { name: 'minecraft:air', setblock: 'minecraft:air' };
      if (entry.name === 'minecraft:air' || entry.name === 'air') continue;
      const x = i % sx;
      const z = Math.floor(i / sx) % sz;
      const y = Math.floor(i / (sx * sz));
      allBlocks.push({ x, y, z, name: entry.name, setblock: entry.setblock });
    }
    paletteInfo.push({ region: rk, size: `${sx}x${sy}x${sz}`, palette: palette.length, nonAir: allBlocks.length });
  }

  // 归一化坐标：从 0 起（去掉最小负偏移）。
  // 注意：allBlocks 可能极大（几十万乃至上百万），Math.min(...arr) 展开会栈溢出，
  // 必须用循环求 min/max。
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of allBlocks) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.z < minZ) minZ = b.z;
  }
  for (const b of allBlocks) {
    b.x -= minX; b.y -= minY; b.z -= minZ;
  }
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const b of allBlocks) {
    if (b.x > maxX) maxX = b.x;
    if (b.y > maxY) maxY = b.y;
    if (b.z > maxZ) maxZ = b.z;
  }

  const out = {
    name: name || path.basename(inputFile, path.extname(inputFile)),
    source: inputFile,
    size: { x: maxX + 1, y: maxY + 1, z: maxZ + 1 },
    totalBlocks: allBlocks.length,
    blocks: allBlocks,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`转换成功: ${name || path.basename(inputFile)}`);
  for (const p of paletteInfo) console.log(`  region ${p.region}: size=${p.size} palette=${p.palette}`);
  console.log(`  归一化尺寸: ${out.size.x}x${out.size.y}x${out.size.z}, 非空气方块: ${out.totalBlocks}`);
  console.log(`  输出: ${outFile}`);
  return out;
}

// 从 .schem/.schematic(Sponge) 转换到同样的 JSON（用 prismarine-schematic）
async function convertSchematic(inputFile, outFile, name) {
  const { Schematic } = require('prismarine-schematic');
  const sch = await Schematic.read(fs.readFileSync(inputFile));
  const { size } = sch;
  const sx = size.x, sy = size.y, sz = size.z;
  const allBlocks = [];
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const idx = y * sz * sx + z * sx + x;
        const stateId = sch.palette[sch.blocks[idx]];
        if (!stateId || stateId === 0) continue;
        const name = sch.stateIds ? sch.stateIds[stateId] : `state:${stateId}`;
        allBlocks.push({ x, y, z, name });
      }
  const minX = Math.min(...allBlocks.map((b) => b.x));
  const minY = Math.min(...allBlocks.map((b) => b.y));
  const minZ = Math.min(...allBlocks.map((b) => b.z));
  for (const b of allBlocks) { b.x -= minX; b.y -= minY; b.z -= minZ; }
  const out = {
    name: name || path.basename(inputFile, path.extname(inputFile)),
    source: inputFile, size: { x: sx, y: sy, z: sz },
    totalBlocks: allBlocks.length, blocks: allBlocks,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`转换成功(Sponge): ${outFile}, ${out.totalBlocks} 方块`);
  return out;
}

if (require.main === module) {
  const [input, out, name] = process.argv.slice(2);
  if (!input || !out) { console.log('用法: node convert-litematic.js <input> <out.json> [name]'); process.exit(1); }
  if (input.endsWith('.litematic')) convertLitematic(input, out, name).catch((e) => { console.error('litematic 转换失败:', e.message); process.exit(1); });
  else convertSchematic(input, out, name).catch((e) => { console.error('schematic 转换失败:', e.message); process.exit(1); });
}

module.exports = { convertLitematic, convertSchematic };
