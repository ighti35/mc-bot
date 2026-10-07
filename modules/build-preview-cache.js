const fs=require('fs'),path=require('path');
const directory=path.join(__dirname,'..','data','build-previews');
function fingerprint(root,files){return JSON.stringify([...files].sort().map(f=>{const s=fs.statSync(path.join(root,f));return[f,s.size,s.mtimeMs];}));}
function read(name,source,destination=directory){
 try{const data=JSON.parse(fs.readFileSync(path.join(destination,name+'.json'),'utf8')),v=data.item,p=v?.preview;
 if(data.format!=='verified-build-preview-v1'||data.source!==source||v?.id!==name||v.error||!v.size||!['x','y','z'].every(k=>Number.isInteger(v.size[k])&&v.size[k]>0)||!Number.isInteger(v.blocks)||v.blocks<=0||!p||!Number.isInteger(p.width)||p.width<1||p.width>40||!Number.isInteger(p.depth)||p.depth<1||p.depth>40||p.cells?.length!==p.width*p.depth||!p.cells.every(c=>Array.isArray(c)&&c.length===2&&Number.isInteger(c[0])&&c[0]>=0&&c[0]<=0xffffffff&&Number.isInteger(c[1])&&c[1]>=0&&c[1]<v.size.y))return null;return v;
 }catch{return null;}
}
function write(name,source,item,destination=directory){fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,name+'.json'),JSON.stringify({format:'verified-build-preview-v1',source,item}));}
module.exports={fingerprint,read,write};
