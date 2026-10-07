# -*- coding: utf-8 -*-
# tools/convert_litemapy.py — 用 litemapy 可靠地把 .litematic 转成 bot 可建的坐标 JSON
# 用法: python convert_litemapy.py <input.litematic> <out.json> <name>
# litemapy 内部正确处理 litematica 的负 Size / Position / bit 打包，避免手写解码在
# 部分图纸上"散架 / 倒立"的问题。
import sys, io, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from litemapy.schematic import Schematic


def block_to_setblock(bs):
    """BlockState -> (name, setblock串)，name 为方块 id（带 minecraft: 前缀，无属性）。"""
    bid = bs.blockid  # 属性：方块 id 字符串
    if not bid or bid == "minecraft:air":
        return None, None
    props = bs.properties()  # 方法：返回 dict_items（(k,v) 对）
    if props:
        attr = ",".join(f"{k}={v}" for k, v in props)
        return bid, f"{bid}[{attr}]"
    return bid, bid


def convert(input_file, out_file, name):
    sch = Schematic.load(input_file)
    all_blocks = []
    for rk, r in sch.regions.items():
        for pos in r.block_positions():
            x, y, z = pos
            b = r[x, y, z]  # litemapy 数组式语法取方块
            nm, sb = block_to_setblock(b)
            if nm is None:
                continue
            all_blocks.append({"x": x, "y": y, "z": z, "name": nm, "setblock": sb})

    if not all_blocks:
        print(f"[{name}] 警告: 无非空气方块，跳过")
        return None

    min_x = min(b["x"] for b in all_blocks)
    min_y = min(b["y"] for b in all_blocks)
    min_z = min(b["z"] for b in all_blocks)
    for b in all_blocks:
        b["x"] -= min_x; b["y"] -= min_y; b["z"] -= min_z
    max_x = max(b["x"] for b in all_blocks)
    max_y = max(b["y"] for b in all_blocks)
    max_z = max(b["z"] for b in all_blocks)

    out = {
        "name": name,
        "source": input_file,
        "size": {"x": max_x + 1, "y": max_y + 1, "z": max_z + 1},
        "totalBlocks": len(all_blocks),
        "blocks": all_blocks,
    }
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"转换成功(litemapy): {name} | size={out['size']['x']}x{out['size']['y']}x{out['size']['z']} | 方块={out['totalBlocks']}")
    # top 方块统计
    cnt = {}
    for b in all_blocks:
        k = b["name"].replace("minecraft:", "")
        cnt[k] = cnt.get(k, 0) + 1
    top = sorted(cnt.items(), key=lambda kv: -kv[1])[:6]
    print("  top:", ", ".join(f"{k}x{v}" for k, v in top))
    print(f"  输出: {out_file}")
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python convert_litemapy.py <input.litematic> <out.json> [name]")
        sys.exit(1)
    inp = sys.argv[1]
    outp = sys.argv[2]
    nm = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(inp).replace(".litematic", "")
    convert(inp, outp, nm)
