// Row runs keep large world exports bounded in memory. Coordinates are local.
function decodePacked(data,name){
  if(data.format!=='block-runs-v1'||!Array.isArray(data.palette)||!Array.isArray(data.runs))throw new Error('压缩图纸格式无效');
  let length=0;for(const r of data.runs)length+=r[3];
  const blocks={length,*[Symbol.iterator](){for(const [x,y,z,count,p]of data.runs){const setblock=data.palette[p],blockName=setblock.split('[')[0];for(let dx=0;dx<count;dx++)yield{x:x+dx,y,z,name:blockName,setblock};}},filter(predicate){const result=[];for(const b of this)if(predicate(b))result.push(b);return result;}};
  return {name,size:data.size,totalBlocks:data.totalBlocks,packed:data,blocks};
}
function validatePacked(s,validateState){
  const data=s.packed,rows=new Map();let total=0;
  if(!data.palette.length)throw new Error('图纸调色板为空');
  for(const text of data.palette){if(typeof text!=='string')throw new Error('图纸方块状态无效');validateState(text);}
  for(const r of data.runs){
    if(!Array.isArray(r)||r.length!==5||!r.every(Number.isInteger))throw new Error('图纸行段无效');
    const[x,y,z,n,p]=r;if(n<=0||x<0||x+n>s.size.x||y<0||y>=s.size.y||z<0||z>=s.size.z||p<0||p>=data.palette.length)throw new Error('图纸坐标或调色板索引超出尺寸');
    const key=`${y},${z}`;if(!rows.has(key))rows.set(key,[]);rows.get(key).push([x,x+n]);total+=n;
  }
  for(const intervals of rows.values()){intervals.sort((a,b)=>a[0]-b[0]);for(let i=1;i<intervals.length;i++)if(intervals[i][0]<intervals[i-1][1])throw new Error('图纸包含重复坐标');}
  if(total!==s.totalBlocks)throw new Error('图纸方块数量不一致');
  return{size:s.size,blocks:total,states:new Set(data.palette).size};
}
function selectBlocks(s,predicate){if(!s.packed)return s.blocks.filter(predicate);const result=[];for(const[x,y,z,n,p]of s.packed.runs){const setblock=s.packed.palette[p],name=setblock.split('[')[0];if(!predicate({name,setblock}))continue;for(let dx=0;dx<n;dx++)result.push({x:x+dx,y,z,name,setblock});}return result;}
module.exports={decodePacked,validatePacked,selectBlocks};
