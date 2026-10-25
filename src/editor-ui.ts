import {elementById, eventElement} from './dom';
import {fontPresentation} from './font-diagnostics';
import {textNormal} from './letter-variants';
import {letterPreamble} from './letter-preamble';
import {EditorModel, texChar, structureTex, catalog, symbols, type Region, type MathNode, type CommandCandidate} from './editor-model';
const palette=[...catalog,...symbols];
let model = new EditorModel(), editing = false, composing = false, sessionStart:string|null = null;
// Keep work across preview reloads, including recovery from a typesetting error.
try {
  const saved=sessionStorage.getItem('math-editor-state') || document.getElementById('recoveredEditorState')?.textContent;
  if(saved)model.restore(saved);
} catch { /* An incompatible saved draft must not prevent the editor opening. */ }
let revision = 0, rendering = false, scheduled = false;
const formula = elementById('formula', HTMLElement), preview = elementById('preview', HTMLElement);
const input = elementById('mathInput', HTMLTextAreaElement), error = elementById('error', HTMLElement);
const fontHint=document.createElement('p');
fontHint.id='fontHint';fontHint.setAttribute('role','status');fontHint.setAttribute('aria-live','polite');
error.after(fontHint);
const preambleDetails=document.createElement('details');
const preambleSummary=document.createElement('summary');preambleSummary.textContent='LaTeX 导出配置（包含字体约定）';
const preambleText=document.createElement('textarea');preambleText.readOnly=true;preambleText.rows=8;preambleText.value=letterPreamble;
preambleText.setAttribute('aria-label','扩展字形的 LaTeX 导言区');
preambleDetails.append(preambleSummary,preambleText);elementById('latex',HTMLTextAreaElement).after(preambleDetails);
const caretTex = '\\class{math-caret}{\\kern0pt}';
const commandMenu=document.createElement('div');
commandMenu.id='commandMenu';commandMenu.className='command-menu';commandMenu.hidden=true;
commandMenu.setAttribute('role','listbox');commandMenu.setAttribute('aria-label','LaTeX 命令候选');document.body.append(commandMenu);
input.setAttribute('aria-controls','commandMenu');input.setAttribute('aria-autocomplete','list');
let commandChoices:CommandCandidate[]=[],commandChoice=0,commandKey='',dismissedCommand='';
function syncCommands(){
  const query=editing && !composing?model.commandQuery():null;
  const key=query?`${model.cursor.region}:${query.from}:${query.end}:${query.name}`:'';
  if(key!==commandKey){commandChoice=0;commandKey=key;dismissedCommand='';}
  commandChoices=query?model.commandCandidates():[];
  commandMenu.hidden=!query || key===dismissedCommand;
  input.setAttribute('aria-expanded',String(!commandMenu.hidden));
  input.removeAttribute('aria-activedescendant');
  commandMenu.replaceChildren();
  if(commandMenu.hidden)return;
  if(!commandChoices.length){const empty=document.createElement('div');empty.className='command-empty';empty.textContent='没有匹配的命令';commandMenu.append(empty);}
  commandChoices.forEach((entry,i)=>{
    const option=document.createElement('div');option.id=`command-option-${i}`;option.dataset.command=entry.name;
    option.setAttribute('role','option');option.setAttribute('aria-selected',String(i===commandChoice));
    const name=document.createElement('code');name.textContent='\\'+entry.name;
    const label=document.createElement('span');label.textContent=entry.label===entry.name?entry.category:entry.label;
    option.append(name,label);commandMenu.append(option);
  });
  const selected=commandMenu.children[commandChoice] as HTMLElement;
  if(commandChoices.length){
    input.setAttribute('aria-activedescendant',selected.id);
    if(selected.offsetTop<commandMenu.scrollTop)commandMenu.scrollTop=selected.offsetTop;
    else if(selected.offsetTop+selected.offsetHeight>commandMenu.scrollTop+commandMenu.clientHeight)
      commandMenu.scrollTop=selected.offsetTop+selected.offsetHeight-commandMenu.clientHeight;
  }
  positionCommands();
}
function positionCommands(){
  if(commandMenu.hidden)return;
  const rect=formula.querySelector('.math-caret')?.getBoundingClientRect();if(!rect)return;
  commandMenu.style.left=Math.max(8,Math.min(rect.left,innerWidth-commandMenu.offsetWidth-8))+'px';
  commandMenu.style.top=Math.max(8,rect.bottom+8+commandMenu.offsetHeight>innerHeight?rect.top-commandMenu.offsetHeight-8:rect.bottom+8)+'px';
}
commandMenu.addEventListener('pointerdown',event=>event.preventDefault());
commandMenu.addEventListener('click',event=>{
  const option=eventElement(event).closest<HTMLElement>('[data-command]');if(!option)return;
  model.commitCommand(true,option.dataset.command);inputEdit=null;input.focus({preventScroll:true});update();
});
document.addEventListener('scroll',positionCommands,true);
const chemicalStates=new Map<string,{source:string;valid:boolean}>();
const isChemical=(node:MathNode)=>node.type==='chem-ce'||node.type==='chem-pu';
async function validateChemistry():Promise<void>{
  const live=new Set<string>();
  for(const node of model.nodes.values()){
    if(!isChemical(node))continue;
    live.add(node.id);
    if(editing && model.cursor.region===node.regions[0].id)continue;
    const source=structureTex(node,regionTex);
    if(chemicalStates.get(node.id)?.source===source)continue;
    let valid=true;
    try {
      const output=await MathJax.tex2chtmlPromise(source,{display:false});
      valid=!output.querySelector('mjx-merror');
    } catch {valid=false;}
    chemicalStates.set(node.id,{source,valid});
  }
  for(const id of chemicalStates.keys())if(!live.has(id))chemicalStates.delete(id);
}
function chemicalTex(node:MathNode):string {
  const child=node.regions[0],source=structureTex(node,regionTex);
  if(!child.items.length)return `\\class{math-region region-${child.id}}{${editing && model.cursor.region===child.id?caretTex:''}\\square}`;
  if(editing && model.cursor.region===child.id || chemicalStates.get(node.id)?.source!==source || !chemicalStates.get(node.id)?.valid)
    return `\\mathrm{${regionTex(child)}}`;
  return `\\class{math-region region-${child.id}}{${source}}`;
}

function regionTex(region:Region):string {
  const descriptive=model.parents.get(region.id)?.node.type==='text-normal';
  const active = editing && model.cursor.region === region.id;
  const [start, end] = active ? model.range : [0, 0];
  let tex = '';
  region.items.forEach((item, i) => {
    if (active && model.cursor.offset === i) tex += caretTex;
    const content = typeof item === 'string' ? (descriptive?textNormal(item,true):texChar(item)) : item.type==='text-normal'?regionTex(item.regions[0]):isChemical(item)?chemicalTex(item):structureTex(item, regionTex);
    const selection = active && i >= start && i < end ? ' math-selected' : '';
    const structureMarker=typeof item==='string' || item.atom?'':` structure-node structure-${item.id}`;
    tex += `\\class{math-item item-${region.id}-${i}${selection}${structureMarker}}{${content}}`;
  });
  if (active && model.cursor.offset === region.items.length) tex += caretTex;
  if (!region.items.length) tex += descriptive?'\\unicode{x25A1}':'\\square';
  const result=`\\class{math-region region-${region.id}}{${tex}}`;
  return descriptive?`\\textnormal{${result}}`:result;
}
function syncInput() {
  if (!editing || composing) return;
  const projection = model.projection(), {offset, anchor} = model.cursor;
  if (input.value !== projection) input.value = projection;
  const units = Array.from(projection);
  const toNative = (index:number) => units.slice(0, index).join('').length;
  const start = toNative(Math.min(offset, anchor)), end = toNative(Math.max(offset, anchor));
  const direction = offset < anchor ? 'backward' : 'forward';
  if (input.selectionStart !== start || input.selectionEnd !== end || (start !== end && input.selectionDirection !== direction)) input.setSelectionRange(start, end, direction);
  input.setAttribute('aria-label', '编辑' + model.current.label);
}
function update(sync = true) {
  syncCommands();
  try { sessionStorage.setItem('math-editor-state',model.snapshot()); } catch { /* Editing also works without storage. */ }
  if (sync) syncInput();
  elementById('latex', HTMLTextAreaElement).value = model.exportLatex();
  preambleDetails.hidden=!/\\(?:math|sym|bb|bfbb)/.test(model.exportLatex());
  revision++;
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }
}

function annotateFontWarnings() {
  const warnings=model.fontWarnings();
  for(const warning of warnings){
    const item=formula.querySelector<HTMLElement>(`.item-${warning.region}-${warning.index}`);
    if(!item)continue;
    item.classList.add('font-warning');
    item.setAttribute('title',warning.message);
    item.setAttribute('aria-invalid','true');
  }
  const active=warnings.find(w=>w.region===model.cursor.region && (w.index===model.cursor.offset || w.index===model.cursor.offset-1));
  fontHint.textContent=active?.message || (warnings.length?`${warnings.length} 处数学样式命令未作用于字符（按 unicode-math 默认映射），已标红线；悬停可查看原因。输入不受影响。`:'');
}
function begin(id:string, offset:number, anchor = offset) {
  if (!editing) sessionStart = model.snapshot();
  editing = true; model.setCursor(id, offset, anchor);
  input.hidden = false; syncInput(); input.focus({preventScroll:true}); update();
}
function finish(cancel = false) {
  if (!editing) return;
  editing = false;
  if (cancel && sessionStart) { model.record(); model.restore(sessionStart); }
  sessionStart = null; input.hidden = true; update();
}
function insertStructure(type:string) {
  if (composing) { composing = false; acceptInput(); }
  if (!editing) begin(model.cursor.region, model.cursor.offset, model.cursor.anchor);
  if(type.startsWith('symbol-'))model.insertSymbol(type);else model.insertStructure(type);
  inputEdit = null;
  syncInput(); input.focus({preventScroll:true}); update();
}
elementById('insertToolbar', HTMLElement).addEventListener('pointerdown', event => {
  // Preserve the native selection and focus while the user clicks a tool.
  if (eventElement(event).closest<HTMLElement>('button')) event.preventDefault();
});
elementById('insertToolbar', HTMLElement).addEventListener('click', event => {
  const button = eventElement(event).closest<HTMLElement>('button[data-insert]');
  if (button?.dataset.insert) insertStructure(button.dataset.insert);
  const category = eventElement(event).closest<HTMLElement>('button[data-category]');
  if (category?.dataset.category) showCategory(category.dataset.category);
});
function showCategory(name:string) {
  closeVariantMenu();
  document.querySelectorAll<HTMLElement>('#insertToolbar [data-category]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.category===name));
  });
  document.querySelectorAll<HTMLElement>('#insertToolbar .structure-group').forEach(panel=>{panel.hidden=panel.dataset.group!==name});
}
function buildBoard() {
  const board=elementById('insertToolbar', HTMLElement),nav=document.createElement('div');
  nav.className='structure-categories';nav.setAttribute('aria-label','结构分类');board.append(nav);
  const visible=palette.filter(entry=>!entry.hidden&&!entry.legacy);
  const categories=[...new Set(['拉丁字母','希腊字母','数字','文字',...visible.map(entry=>entry.category)])];
  categories.forEach(category=>{
    const tab=document.createElement('button');tab.dataset.category=category;tab.textContent=category;tab.setAttribute('aria-pressed','false');nav.append(tab);
    const panel=document.createElement('div');panel.className='structure-group';panel.dataset.group=category;panel.setAttribute('role','group');panel.setAttribute('aria-label',category);
    visible.filter(entry=>entry.category===category && (!entry.variantOf || entry.variantOf===entry.type)).forEach(entry=>{
      const card=document.createElement('button');card.dataset.insert=entry.type;card.className='structure-card';card.setAttribute('aria-label','插入'+entry.label);
      card.title=entry.label+' · '+(entry.command?entry.command+' · ':'')+(entry.font?'选区应用字体；无选区时在此字体中输入':(entry.labels||[]).join(' / '));
      if(entry.letter)card.title=entry.label+' · 插入此字母；右击选择可用字形';
      const coverage=entry.font?fontPresentation(entry.command)?.coverage:undefined;
      if(coverage)card.title+=' · '+coverage;
      if(entry.operator)card.title=entry.label+' · \\'+entry.operatorCommand+' · 插入符号；^ / _ 或右击添加上下限';
      if(entry.atom || entry.font)card.classList.add('compact-card');
      if(entry.variantOf){card.title+=' · 右击选择变体';card.setAttribute('aria-haspopup','menu');card.setAttribute('aria-expanded','false');}
      const sample=entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>'\\square'));
      const preview=document.createElement('span');preview.className='structure-preview';preview.setAttribute('aria-hidden','true');preview.textContent='\\(\\displaystyle '+sample+'\\)';
      const label=document.createElement('span');label.className='structure-label';label.textContent=entry.label;card.append(preview,label);panel.append(card);
    });
    board.append(panel);
  });
  elementById('structureCount', HTMLElement).textContent='右击按钮选择变体 · '+categories.length+' 个分类';
  document.querySelectorAll<HTMLElement>('[data-count-category]').forEach(cell=>{cell.textContent=catalog.filter(entry=>entry.category===cell.dataset.countCategory).length+' 种预设；悬停查看确切语法'});
  showCategory(categories[0]);
}
const variantMenu = document.createElement('div');
variantMenu.className='variant-menu';variantMenu.id='variantMenu';variantMenu.hidden=true;
variantMenu.setAttribute('role','menu');document.body.append(variantMenu);
let variantTrigger:HTMLElement|null=null, variantNodeId:string|undefined, variantCellId:string|undefined;
let variantLetter:{region:string;index:number}|null=null;
function closeVariantMenu(restoreFocus=false){
  variantMenu.hidden=true;
  variantTrigger?.setAttribute('aria-expanded','false');
  if(restoreFocus){if(editing)input.focus({preventScroll:true});else variantTrigger?.focus({preventScroll:true});}
  variantTrigger=null;variantNodeId=undefined;variantCellId=undefined;
  variantLetter=null;
}
function openVariantMenu(button:HTMLElement,x:number,y:number,node:MathNode|null=null,cellRegionId?:string){
  const definition=node?palette.find(entry=>entry.type===node.type):null;
  const entries=palette.filter(entry=>!entry.hidden && !entry.legacy && entry.variantOf===(node?definition?.variantOf:button.dataset.insert) && entry.variantOf && !(node && entry.type==='matrix3'));
  if(!entries.length && !definition?.matrixEnvironment && !definition?.rowEnvironment && !definition?.operator)return;
  closeVariantMenu();variantTrigger=button;variantNodeId=node?.id;MathJax.typesetClear([variantMenu]);variantMenu.replaceChildren();
  variantMenu.setAttribute('aria-label',node?'切换'+definition!.label+'的变体':button.getAttribute('aria-label')+'的变体');
  if(node && definition?.operator){
    definition.scriptSlots!.forEach((slot,i)=>{
      const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
      option.dataset.scriptSlot=slot;option.textContent=(node.regions.some(r=>r.slot===slot)?'移除':'添加')+definition.scriptLabels![i];variantMenu.append(option);
    });
    if(entries.length){const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
  }
  if(node && (definition?.matrixEnvironment || definition?.rowEnvironment)){
    const matrix=Boolean(definition.matrixEnvironment);
    const cell=model.tableCell(node.id,cellRegionId)||model.tableCell(node.id)||model.tableCell(node.id,node.regions[0].id);
    if(!cell)return;
    variantCellId=node.regions[cell.index].id;
    const heading=document.createElement('div');heading.className='menu-heading';
    heading.textContent=matrix?`${node.rows} × ${node.columns} 矩阵 · 第 ${cell.row+1} 行，第 ${cell.column+1} 列`:`${node.rows} 行 · 当前第 ${cell.row+1} 行`;variantMenu.append(heading);
    for(const [action,label] of [['rowBefore','在此行上方插入行'],['rowAfter','在此行下方插入行'],['columnBefore','在此列左侧插入列'],['columnAfter','在此列右侧插入列'],['deleteRow','删除此行'],['deleteColumn','删除此列']]){
      if(!matrix && action.toLowerCase().includes('column'))continue;
      const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
      option.dataset.matrixAction=action;option.textContent=label;
      option.disabled=(action==='deleteRow' && node.rows===1)||(action==='deleteColumn' && node.columns===1);
      if(option.disabled)option.title=matrix?'矩阵至少保留一行、一列':'至少保留一行';
      variantMenu.append(option);
    }
    if(entries.length){const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
  }
  for(const entry of entries){
    const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
    option.dataset.variant=entry.type;
    const sample=(entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>'\\square')))!.trim();
    const glyph=document.createElement('span');glyph.className='variant-preview';glyph.setAttribute('aria-hidden','true');
    const command=document.createElement('code');command.textContent=(entry.equivalentTex??[entry.exportTex??sample]).join(' = ');
    option.setAttribute('aria-label',command.textContent);option.title=command.textContent;option.classList.add('rendered-variant');
    option.append(glyph,command);
    // Render into this option only: a closed/reopened menu must not receive stale results.
    glyph.textContent='\\('+sample+'\\)';
    void MathJax.typesetPromise([glyph]).then(()=>{
      if(!option.isConnected)return;
      if(!variantMenu.hidden){
        const rect=variantMenu.getBoundingClientRect();
        variantMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';
        variantMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
      }
    }).catch(()=>{glyph.textContent='—';glyph.title='预览暂不可用';});
    if(entry.font){const coverage=fontPresentation(entry.command)?.coverage;if(coverage)option.title+=' · '+coverage;}
    if(node){
      option.setAttribute('role','menuitemradio');option.setAttribute('aria-checked',String(entry.type===node.type || (!!entry.glyphKey&&entry.glyphKey===definition?.glyphKey) || (!!entry.tex&&entry.tex===definition?.tex) || (node.type==='matrix3' && entry.type==='matrix')));
      option.disabled=!!node.id&&!model.canSwitchVariant(node.id,entry.type);
      if(option.disabled){option.title='先移走超出目标尺寸的单元格内容';}
    }
    variantMenu.append(option);
  }
  button.setAttribute('aria-expanded','true');variantMenu.hidden=false;
  const rect=variantMenu.getBoundingClientRect();
  variantMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';
  variantMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
}
elementById('insertToolbar', HTMLElement).addEventListener('contextmenu',event=>{
  const button=eventElement(event).closest<HTMLElement>('button[data-insert]');if(!button?.hasAttribute('aria-haspopup'))return;
  event.preventDefault();openVariantMenu(button,event.clientX,event.clientY);
});
elementById('insertToolbar', HTMLElement).addEventListener('keydown',event=>{
  const button=eventElement(event).closest<HTMLElement>('button[aria-haspopup]');
  if(button && (event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){
    event.preventDefault();const rect=button.getBoundingClientRect();openVariantMenu(button,rect.left,rect.bottom);
  }
});
variantMenu.addEventListener('pointerdown',event=>event.preventDefault());
variantMenu.addEventListener('click',event=>{
  const option=eventElement(event).closest<HTMLButtonElement>('[data-variant],[data-matrix-action],[data-script-slot]');if(!option)return;
  if(option.disabled)return;
  const nodeId=variantNodeId,cellId=variantCellId,letter=variantLetter;closeVariantMenu();
  if(letter && option.dataset.variant){model.switchLetter(letter.region,letter.index,option.dataset.variant);update();}
  else if(nodeId){
    if(option.dataset.scriptSlot){
      if(!editing)begin(model.cursor.region,model.cursor.offset,model.cursor.anchor);
      const slot=option.dataset.scriptSlot;
      if(slot==='lower'||slot==='upper'||slot==='leftLower'||slot==='leftUpper')model.toggleOperatorScript(nodeId,slot);
    }else if(option.dataset.matrixAction){
      if(!editing)begin(model.cursor.region,model.cursor.offset,model.cursor.anchor);
      if(cellId)model.editTable(nodeId,cellId,option.dataset.matrixAction);
    }else{
      if(!editing && option.dataset.variant==='nthroot')begin(model.cursor.region,model.cursor.offset,model.cursor.anchor);
      if(option.dataset.variant)model.switchVariant(nodeId,option.dataset.variant);
    }
    inputEdit=null;syncInput();
    if(editing)input.focus({preventScroll:true});update();
  }else if(option.dataset.variant)insertStructure(option.dataset.variant);
});
document.addEventListener('pointerdown',event=>{
  if(!variantMenu.hidden&&!variantMenu.contains(eventElement(event)))closeVariantMenu();
},true);
document.addEventListener('keydown',event=>{
  if(variantMenu.hidden)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeVariantMenu(true);}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();
    const options=[...variantMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],i=options.findIndex(option=>option===document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:(i+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;
    options[next].focus({preventScroll:true});
  }else if(event.key==='Tab')closeVariantMenu();
},true);
window.addEventListener('resize',()=>closeVariantMenu());
document.addEventListener('scroll',event=>{if(!variantMenu.contains(eventElement(event)))closeVariantMenu();},true);
buildBoard();
function positionInput() {
  if (!editing) return;
  const caret = formula.querySelector('.math-caret'); if (!caret) return;
  const rect = caret.getBoundingClientRect(), box = preview.getBoundingClientRect();
  input.style.left = (rect.left - box.left - preview.clientLeft + preview.scrollLeft) + 'px';
  input.style.top = (rect.top - box.top - preview.clientTop + preview.scrollTop) + 'px';
  positionCommands();
}
async function render() {
  if (!window.ready || rendering) return;
  rendering = true;
  const stage = document.createElement('div'); stage.id = 'renderStage'; stage.setAttribute('aria-hidden', 'true');
  stage.style.width = formula.clientWidth + 'px'; document.body.append(stage);
  try {
    let rendered;
    do {
      rendered = revision;
      await validateChemistry();
      MathJax.typesetClear([stage]);
      // Small inline hit areas travel with the formula when embedded in text.
      const edge = (side:string) => `\\class{math-boundary boundary-${side}}{\\vphantom{Xg}\\kern0.4em}`;
      stage.textContent = '\\[' + edge('start') + regionTex(model.root) + edge('end') + '\\]';
      await MathJax.typesetPromise([stage]);
      const failed=stage.querySelector('mjx-merror');
      if(failed)throw new Error(failed.textContent || 'MathJax 无法排版');
    } while (rendered !== revision);
    MathJax.typesetClear([formula]); formula.replaceChildren(...stage.childNodes);
    error.textContent = [...chemicalStates.values()].some(state=>!state.valid)?'化学语法尚未完整，已保留源码；点击该区域可继续编辑。':''; annotateFontWarnings(); positionInput();
  } catch (err) { error.textContent = '公式排版失败：' + String(err); }
  finally { MathJax.typesetClear([stage]); stage.remove(); rendering = false; }
}

// Hit testing maps glyphs to offsets in their enclosing sequence. These DOM
// markers do not create editing fields; a, + and a fraction share one region.
function regionId(element:Element):string { return [...element.classList].find(c => c.startsWith('region-'))?.slice(7) || ''; }
function itemIndex(element:Element, id:string) {
  const prefix = 'item-' + id + '-';
  return Number([...element.classList].find(c => c.startsWith(prefix))?.slice(prefix.length));
}
function hit(target:Element, x:number) {
  const boundary=target.closest('.math-boundary');
  if(boundary && formula.contains(boundary))return {id:model.root.id,offset:boundary.classList.contains('boundary-start')?0:model.root.items.length};
  const regionElement = target.closest('.math-region');
  if (!regionElement || !formula.contains(regionElement)) return null;
  const id = regionId(regionElement), region = model.regions.get(id); if (!region) return null;
  const owner=model.parents.get(id)?.node;
  if(owner && isChemical(owner) && !formula.querySelector(`.item-${id}-0`))return {id,offset:region.items.length};
  const itemElement = target.closest('.math-item');
  if (itemElement && itemElement.closest('.math-region') === regionElement) {
    const index = itemIndex(itemElement, id), item = region.items[index];
    if (typeof item !== 'string' && item && !item.atom && item.regions.length) return {id: item.regions[0].id, offset: 0};
    const rect = itemElement.getBoundingClientRect();
    return {id, offset: index + (x > (rect.left + rect.right) / 2 ? 1 : 0)};
  }
  let offset = 0, distance = Infinity;
  region.items.forEach((_, i) => {
    const el = regionElement.querySelector('.item-' + id + '-' + i); if (!el) return;
    const rect = el.getBoundingClientRect();
    for (const [px, pos] of [[rect.left, i], [rect.right, i + 1]]) {
      if (Math.abs(x - px) < distance) { distance = Math.abs(x - px); offset = pos; }
    }
  });
  return {id, offset};
}
let drag:{id:string;anchor:number;x:number;y:number}|null = null;
formula.addEventListener('pointerdown', event => {
  if(event.button!==0){event.preventDefault();return;}
  const point = hit(eventElement(event), event.clientX) || (error.textContent?{id:model.cursor.region,offset:model.cursor.offset}:null); if (!point) return;
  event.preventDefault(); event.stopPropagation();
  const anchor = event.shiftKey && editing && model.cursor.region === point.id ? model.cursor.anchor : point.offset;
  begin(point.id, point.offset, anchor);
  drag = {id: point.id, anchor, x: event.clientX, y: event.clientY};
  formula.setPointerCapture(event.pointerId);
});
formula.addEventListener('pointermove', event => {
  if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
  const target = document.elementFromPoint(event.clientX, event.clientY); if (!target) return;
  const point = hit(target, event.clientX);
  if (point?.id === drag.id) { model.setCursor(point.id, point.offset, drag.anchor); update(); }
});
formula.addEventListener('pointerup', () => { drag = null; });
formula.addEventListener('pointercancel', () => { drag = null; });
formula.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
formula.addEventListener('contextmenu',event=>{
  const target=eventElement(event),rElement=target.closest('.math-region'),iElement=target.closest<HTMLElement>('.math-item');
  if(rElement&&iElement){
    const rid=regionId(rElement),index=itemIndex(iElement,rid),item=model.regions.get(rid)?.items[index];
    const def=typeof item==='string'?symbols.find(d=>d.letter===item&&d.variantOf===d.type):symbols.find(d=>d.type===item?.type);
    if(def?.letter&&model.parents.get(rid)?.node.type!=='text-normal'){
      event.preventDefault();event.stopPropagation();
      openVariantMenu(iElement,event.clientX,event.clientY,typeof item==='string'?{id:'',type:def.type,atom:true,regions:[]}:item!);
      variantLetter={region:rid,index};return;
    }
  }
  let element:HTMLElement|null=eventElement(event).closest<HTMLElement>('.structure-node');
  while(element && formula.contains(element)){
    const id=[...element.classList].find(name=>/^structure-n\d+$/.test(name))?.slice(10);
    const node=id?model.nodes.get(id):undefined;
    const definition=catalog.find(entry=>entry.type===node?.type);
    if(node && !definition?.font && (definition?.operator || definition?.variantOf || definition?.matrixEnvironment || definition?.rowEnvironment)){
      const regionElement=eventElement(event).closest<HTMLElement>('.math-region');
      event.preventDefault();event.stopPropagation();openVariantMenu(element,event.clientX,event.clientY,node,regionElement?regionId(regionElement):undefined);return;
    }
    element=element.parentElement?.closest<HTMLElement>('.structure-node') || null;
  }
},true);
formula.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(model.root.id, model.root.items.length); }
});
input.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if(!commandMenu.hidden && !event.ctrlKey && !event.metaKey && !event.altKey){
    if(event.key==='Escape'){event.preventDefault();dismissedCommand=commandKey;syncCommands();return;}
    if(commandChoices.length && ['ArrowUp','ArrowDown','Tab','Enter'].includes(event.key)){
      event.preventDefault();
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){
        commandChoice=(commandChoice+(event.key==='ArrowDown'?1:-1)+commandChoices.length)%commandChoices.length;syncCommands();
      }else{model.commitCommand(true,commandChoices[commandChoice].name);inputEdit=null;update();}
      return;
    }
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && ['z','y'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.key.toLowerCase() === 'y' || event.shiftKey) model.redo(); else model.undo();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); model.move(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); model.vertical(event.key === 'ArrowUp' ? -1 : 1);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault(); model.setCursor(model.cursor.region, event.key === 'Home' ? 0 : model.current.items.length, event.shiftKey ? model.cursor.anchor : undefined);
  } else if (event.key === 'Tab') {
    event.preventDefault(); if(event.shiftKey || !model.commitCommand())model.tab(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault(); model.remove(event.key === 'Backspace' ? -1 : 1);
  } else if (event.key === 'Enter' || event.key === 'Escape') {
    if(event.key==='Enter' && model.commitCommand()){event.preventDefault();update();return;}
    event.preventDefault(); finish(event.key === 'Escape'); formula.focus(); return;
  } else return;
  update();
});
let inputEdit:{region:string;start:number;end:number}|null = null;
input.addEventListener('beforeinput', event => {
  if (!editing || composing) return;
  let start = Array.from(input.value.slice(0, input.selectionStart)).length;
  let end = Array.from(input.value.slice(0, input.selectionEnd)).length;
  if (start === end && event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
  if (start === end && event.inputType === 'deleteContentForward') end = Math.min(model.current.items.length, end + 1);
  inputEdit = {region: model.cursor.region, start, end};
});
function acceptInput() {
  if (!editing || composing) return;
  const before = Array.from(model.projection()), after = Array.from(input.value);
  const edit = inputEdit; inputEdit = null;
  if (before.join('') === after.join('')) return;
  // Use the native insertion range rather than a longest-prefix diff: typing
  // another '+' immediately before '+' must not move past the existing one.
  if (edit?.region === model.cursor.region) {
    const length = after.length - before.length + edit.end - edit.start;
    if (length >= 0) {
      model.replaceInput(edit.start, edit.end, after.slice(edit.start, edit.start + length).join(''));
      update(); return;
    }
  }
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  model.replaceInput(start, before.length - suffix, after.slice(start, after.length - suffix).join(''));
  update();
}
input.addEventListener('input', acceptInput);
input.addEventListener('compositionstart', () => {
  inputEdit = {region: model.cursor.region, start: model.range[0], end: model.range[1]};
  composing = true;
  syncCommands();
});
input.addEventListener('compositionend', () => { composing = false; acceptInput(); });
document.addEventListener('selectionchange', () => {
  if (!editing || composing || document.activeElement !== input || input.value !== model.projection()) return;
  const start = Array.from(input.value.slice(0, input.selectionStart)).length;
  const end = Array.from(input.value.slice(0, input.selectionEnd)).length;
  const offset = input.selectionDirection === 'backward' ? start : end, anchor = input.selectionDirection === 'backward' ? end : start;
  if (offset !== model.cursor.offset || anchor !== model.cursor.anchor) { model.setCursor(model.cursor.region, offset, anchor); update(false); }
});
input.addEventListener('blur', () => { if (editing) { if (composing) { composing = false; acceptInput(); } finish(); } });
input.addEventListener('copy', event => {
  const [a,b] = model.range; if (a === b) return;
  const r = {items: model.current.items.slice(a,b)};
  const plain = (node:Pick<Region,'items'>):string => node.items.map(item => typeof item === 'string' ? texChar(item) : structureTex(item, plain)).join('');
  event.preventDefault(); event.clipboardData?.setData('text/plain', model.rawInput?r.items.join(''):plain(r));
});
window.addEventListener('resize', positionInput);
new ResizeObserver(positionInput).observe(preview);
window.mathjaxLoadFailed = () => { error.textContent = 'MathJax 加载失败，请检查网络连接。'; };
window.addEventListener('mathjax-ready',()=>render());
setTimeout(() => { if (!window.ready) error.textContent = 'MathJax 尚未就绪，请检查网络连接。'; }, 10000);
update();
