const fs=require('fs');
const path=require('path');
const nbt=require('prismarine-nbt');
const directory=path.join(__dirname,'..','data','schematics');
function compatibleBlock(value){return value.replace(/^minecraft:chain(?=\[|$)/,'minecraft:iron_chain').replace(/^minecraft:grass(?=\[|$)/,'minecraft:short_grass');}
function compatibleSchematic(s){for(const b of s.blocks){b.name=compatibleBlock(b.name);if(b.setblock)b.setblock=compatibleBlock(b.setblock);}return s;}
function decodeLitematic(root,name){
  const blocks=new Map();
  for(const region of Object.values(root.Regions||{})){
    const size=region.Size,position=region.Position;
    const sx=Math.abs(size.x),sy=Math.abs(size.y),sz=Math.abs(size.z);
    const palette=region.BlockStatePalette;
    const bits=Math.max(2,Math.ceil(Math.log2(palette.length))),mask=(1n<<BigInt(bits))-1n;
    const longs=region.BlockStates.map(value=>BigInt.asUintN(64,typeof value==='bigint'?value:(BigInt(value[0]>>>0)<<32n)|BigInt(value[1]>>>0)));
    if(longs.length*64<sx*sy*sz*bits)throw new Error('图纸方块数据不完整');
    const base={x:position.x+Math.min(0,size.x+1),y:position.y+Math.min(0,size.y+1),z:position.z+Math.min(0,size.z+1)};
    for(let i=0;i<sx*sy*sz;i++){
      const offset=i*bits,index=Math.floor(offset/64),shift=offset%64;
      let value=longs[index]>>BigInt(shift);
      if(shift+bits>64)value|=longs[index+1]<<BigInt(64-shift);
      const entry=palette[Number(value&mask)];
      if(!entry)throw new Error('图纸调色板索引无效');
      if(['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(entry.Name))continue;
      const x=base.x+i%sx,z=base.z+Math.floor(i/sx)%sz,y=base.y+Math.floor(i/(sx*sz));
      const props=Object.entries(entry.Properties||{}).map(([k,v])=>`${k}=${v}`).join(',');
      blocks.set(`${x},${y},${z}`,{x,y,z,name:entry.Name,setblock:entry.Name+(props?`[${props}]`:'')});
    }
  }
  const values=[...blocks.values()];if(!values.length)throw new Error('图纸没有非空气方块');
  const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const b of values)for(const axis of ['x','y','z']){min[axis]=Math.min(min[axis],b[axis]);max[axis]=Math.max(max[axis],b[axis]);}
  for(const b of values)for(const axis of ['x','y','z'])b[axis]-=min[axis];
  return {name,size:{x:max.x-min.x+1,y:max.y-min.y+1,z:max.z-min.z+1},totalBlocks:values.length,blocks:values};
}
async function loadSchematic(name,extension){
  name=require('./schematic-catalog').resolveSchematicName(name);
  if(typeof name!=='string'||!/^[a-z0-9_-]+$/i.test(name))throw new Error('图纸名称无效');
  const json=path.join(directory,name+'.json'),litematic=path.join(directory,name+'.litematic');
  if((!extension||extension==='.litematic')&&fs.existsSync(litematic)){const result=await nbt.parse(fs.readFileSync(litematic));return compatibleSchematic(decodeLitematic(nbt.simplify(result.parsed),name));}
  if((!extension||extension==='.json')&&fs.existsSync(json)){const data=JSON.parse(fs.readFileSync(json,'utf8'));if(data.format==='block-runs-v1'){data.palette=data.palette.map(compatibleBlock);return require('./packed-schematic').decodePacked(data,name);}return compatibleSchematic(data);}
  for(const ext of ['.schem','.schematic'])if((!extension||extension===ext)&&fs.existsSync(path.join(directory,name+ext))){
    const {Schematic}=require('prismarine-schematic'),{Vec3}=require('vec3');
    const parsed=await nbt.parse(fs.readFileSync(path.join(directory,name+ext)));
    function rename(node){if(!node||typeof node!=='object')return;for(const key of Object.keys(node)){const value=node[key];const mapped=compatibleBlock(key);if(mapped!==key){node[mapped]=value;delete node[key];}if(typeof value==='string'&&value.startsWith('minecraft:'))node[mapped]=compatibleBlock(value);else rename(value);}}
    rename(parsed.parsed);
    const schematic=await Schematic.read(nbt.writeUncompressed(parsed.parsed),'1.21.11'),blocks=[];
    for(let y=0;y<schematic.size.y;y++)for(let z=0;z<schematic.size.z;z++)for(let x=0;x<schematic.size.x;x++){
      const b=schematic.getBlock(new Vec3(x,y,z).plus(schematic.offset));
      if(['air','cave_air','void_air'].includes(b.name))continue;
      const props=Object.entries(b.getProperties()).map(([k,v])=>`${k}=${v}`).join(',');
      blocks.push({x,y,z,name:'minecraft:'+b.name,setblock:'minecraft:'+b.name+(props?`[${props}]`:'')});
    }
    return {name,size:{x:schematic.size.x,y:schematic.size.y,z:schematic.size.z},totalBlocks:blocks.length,blocks};
  }
  const pending=require('./mega-builds').find(m=>m.name===name);if(pending?.unavailable)throw new Error(pending.unavailable);
  return null;
}
function validateSchematic(schematic,registry=require('minecraft-data')('1.21.11')){
  if(!schematic?.blocks?.length)throw new Error('图纸没有可建造方块');
  for(const axis of ['x','y','z'])if(!Number.isInteger(schematic.size?.[axis])||schematic.size[axis]<=0)throw new Error('图纸尺寸无效');
  if(schematic.packed)return require('./packed-schematic').validatePacked(schematic,text=>validateSchematic({size:{x:1,y:1,z:1},totalBlocks:1,blocks:[{x:0,y:0,z:0,name:text.split('[')[0],setblock:text}]},registry));
  const states=new Set(),positions=new Set();
  for(const b of schematic.blocks){
    for(const axis of ['x','y','z'])if(!Number.isInteger(b[axis])||b[axis]<0||b[axis]>=schematic.size[axis])throw new Error('图纸坐标超出尺寸');
    const key=`${b.x},${b.y},${b.z}`;if(positions.has(key))throw new Error('图纸包含重复坐标');positions.add(key);
    const text=b.setblock||b.name;if(states.has(text))continue;states.add(text);
    const match=/^(?:minecraft:)?([a-z0-9_]+)(?:\[([^\]]+)\])?$/.exec(text);
    const block=match&&registry.blocksByName[match[1]];if(!block)throw new Error(`当前版本不支持图纸方块：${text}`);
    for(const attr of (match[2]||'').split(',').filter(Boolean)){
      const [key,value]=attr.split('='),property=block.states?.find(s=>s.name===key);
      if(!property||!(property.type==='bool'?['true','false']:property.values||Array.from({length:property.num_values},(_,i)=>String(i))).map(String).includes(value))throw new Error(`当前版本不支持图纸属性：${text}`);
    }
  }
  if(schematic.totalBlocks!==schematic.blocks.length)throw new Error('图纸方块数量不一致');
  return {size:schematic.size,blocks:schematic.blocks.length,states:states.size};
}
module.exports={loadSchematic,decodeLitematic,validateSchematic,directory};
