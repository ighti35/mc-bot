'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="panel-token"]').content;
let snapshot = null, selected = null, pending = false, refreshing = false, catalogLoaded = false;
const buttons = new Map();
function makeSlot(slot, target, caption) {
  const button = document.createElement('button'); button.className = 'slot'; button.type = 'button';
  button.addEventListener('click', () => { selected = slot; $('take-count').value = 1; render(); });
  buttons.set(slot, button);
  if (caption) { const wrapper = document.createElement('div'); const label = document.createElement('div'); label.className = 'equiplabel'; label.textContent = caption; wrapper.append(button, label); target.append(wrapper); }
  else target.append(button);
}
for (let slot = 9; slot <= 35; slot++) makeSlot(slot, $('bag'));
for (let slot = 36; slot <= 44; slot++) makeSlot(slot, $('hotbar'));
[['头盔',5],['胸甲',6],['护腿',7],['靴子',8],['副手',45]].forEach(([name,slot]) => makeSlot(slot, $('equipment'), name));
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
function render() {
  if (!snapshot) return;
  const s = snapshot, slots = new Map(s.slots.map(entry => [entry.slot,entry.item]));
  $('dot').className = s.connected ? 'dot online' : 'dot';
  $('connection').textContent = s.connected ? `已连接 · 主人 ${s.owner} ${s.ownerVisible ? '在视野内' : '暂不在视野内'}` : '机器人尚未进入世界，等待连接…';
  $('username').textContent = s.username; $('vitals').textContent = s.connected ? `${s.health ?? '—'} / ${s.food ?? '—'}` : '—';
  $('position').textContent = s.position ? `${s.position.x}, ${s.position.y}, ${s.position.z}` : '—';
  $('usage').textContent = `${s.usedSlots} / 36`; $('server-port').textContent = s.serverPort;
  $('task').textContent = s.busy || '空闲 · 可以管理物品';
  for (const [slot, button] of buttons) {
    const item = slots.get(slot); button.replaceChildren(); button.classList.toggle('selected', selected === slot);
    button.setAttribute('aria-label', item ? `${item.label}，${item.count} 个，第 ${slot} 格` : `第 ${slot} 格，空`);
    button.title = item ? `${item.label} (${item.name}) × ${item.count}` : '空格';
    if (item) { const img = document.createElement('img'); img.src = `/icons/${encodeURIComponent(item.name)}.svg`; img.alt = ''; const count = document.createElement('span'); count.className = 'count'; count.textContent = item.count; button.append(img,count); }
    else { const label = document.createElement('span'); label.className = 'slotlabel'; label.textContent = slot >= 36 && slot <= 44 ? slot - 35 : '·'; button.append(label); }
  }
  const item = slots.get(selected);
  $('selected-title').textContent = item ? item.label : selected === null ? '选择一个物品' : '空格';
  $('selected-info').textContent = item ? [`${item.name} · 第 ${selected} 格 · ${item.count} 个`, item.maxDurability ? `耐久 ${item.durabilityLeft} / ${item.maxDurability}` : '', ...(item.enchants || []).map(e => `${e.name} ${e.level}`), item.customName || ''].filter(Boolean).join('\n') : '点击左侧背包中的格子。';
  $('take-count').max = item?.count || 1;
  $('take').disabled = pending || !s.connected || !!s.busy || !item || !s.ownerVisible;
  $('add').disabled = pending || !s.connected || !!s.busy || !s.canAdd;
  $('stop').disabled = pending || !s.connected;
  $('permission').textContent = s.canAdd ? '已获得 /give 权限。添加后会等待服务器确认。' : `需要机器人的 OP 权限。请在游戏中执行 /op ${s.username}，然后刷新。`;
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const response = await fetch('/api/state'); if (!response.ok) throw new Error('无法读取机器人状态'); snapshot = await response.json(); render();
    if (snapshot.connected && !catalogLoaded) {
      const result = await fetch('/api/items'); if (!result.ok) throw new Error('无法读取物品列表');
      const data = await result.json(); const fragment = document.createDocumentFragment();
      for (const item of data.items) { const option = document.createElement('option'); option.value = item.name; option.label = item.label; fragment.append(option); if (item.label !== item.name) { const alias = document.createElement('option'); alias.value = item.label; alias.label = item.name; fragment.append(alias); } }
      $('items').replaceChildren(fragment); catalogLoaded = true;
    }
  } catch (error) { message(`面板连接失败：${error.message}`, true); } finally { refreshing = false; }
}
async function action(body) {
  if (pending) return; pending = true; render(); message('正在执行，请稍候…');
  try {
    const response = await fetch('/api/action', { method:'POST', headers:{'Content-Type':'application/json','X-Panel-Token':token}, body:JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败'); message(result.message);
  } catch (error) { message(error.message, true); }
  finally { pending = false; await refresh(); render(); }
}
$('take').addEventListener('click', () => { const item = snapshot?.slots.find(entry => entry.slot === selected)?.item; if (item) action({action:'take',slot:selected,fingerprint:item.fingerprint,count:Number($('take-count').value)}); });
$('add').addEventListener('click', () => action({action:'add',item:$('item').value.trim(),count:Number($('add-count').value)}));
$('stop').addEventListener('click', () => action({action:'stop'}));
$('refresh').addEventListener('click', refresh);
refresh(); setInterval(refresh, 1000);
