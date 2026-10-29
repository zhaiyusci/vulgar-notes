import {t,locale,mathLabel,mathRegionLabel} from './i18n';
import {elementById, eventElement} from './dom';
import {fontPresentation} from './font-diagnostics';
import {textNormal,preferredMathCommand} from './letter-variants';
import {documentSessionId} from './platform';
import type {DocumentHost,DocumentHostFactory} from './document-host';
import {EditorModel, texChar, structureTex, catalog, symbols, type Region, type MathNode, type CommandCandidate} from './editor-model';
import {normalizeMathSource} from './tex-import';
import {convertMath} from './tex-convert';
import {readNativeClipboard,writeNativeClipboard,nativeClipboardHtml,type NativeMathFragment} from './native-clipboard';
import {extractClipboardMathHtml} from './document-clipboard-format';
import {standaloneMathEnvironmentBounds} from './tex-display-environment';
import {equationNumbering} from './math-equation-numbering';
const palette=[...catalog,...symbols];
let model = new EditorModel(), editing = false, composing = false, sessionStart:string|null = null;
const documentSession = documentSessionId();
const mathStateKey = 'math-editor-state' + (documentSession ? ':' + documentSession : '');
// Keep work across preview reloads, including recovery from a typesetting error.
try {
  const saved=sessionStorage.getItem(mathStateKey) || (!documentSession ? document.getElementById('recoveredEditorState')?.textContent : null);
  if(saved)model.restore(saved);
} catch { /* An incompatible saved draft must not prevent the editor opening. */ }
let revision = 0, rendering:Promise<void>|undefined, scheduled = false;
let lastRenderFailure:unknown;
let formula = elementById('formula', HTMLElement);
const preview = elementById('preview', HTMLElement);
let flow:DocumentHost|undefined;
const input = elementById('mathInput', HTMLTextAreaElement), error = elementById('error', HTMLElement);
const fontHint=document.createElement('p');
fontHint.id='fontHint';fontHint.setAttribute('role','status');fontHint.setAttribute('aria-live','polite');
error.after(fontHint);
const caretTex = '\\class{math-caret}{\\kern0pt}';
const placeholderTex='\\class{math-placeholder}{\\phantom{0}}';
const commandMenu=document.createElement('div');
commandMenu.id='commandMenu';commandMenu.className='command-menu';commandMenu.hidden=true;
commandMenu.setAttribute('role','listbox');commandMenu.setAttribute('aria-label',t('LaTeX 命令候选'));document.body.append(commandMenu);
input.setAttribute('aria-controls','commandMenu');input.setAttribute('aria-autocomplete','list');
let commandChoices:CommandCandidate[]=[],commandChoice=0,commandKey='',dismissedCommand='';
function syncCommands(){
  const query=editing && !composing?model.commandQuery():null;
  const key=query?`${model.cursor.region}:${query.from}:${query.end}:${query.name}`:'';
  if(key!==commandKey){commandChoice=0;commandKey=key;dismissedCommand='';}
  commandChoices=query?model.commandCandidates().slice(0,80):[];
  commandMenu.hidden=!query || key===dismissedCommand;
  input.setAttribute('aria-expanded',String(!commandMenu.hidden));
  input.removeAttribute('aria-activedescendant');
  commandMenu.replaceChildren();
  if(commandMenu.hidden)return;
  if(!commandChoices.length){const empty=document.createElement('div');empty.className='command-empty';empty.textContent=t('没有匹配的命令');commandMenu.append(empty);}
  commandChoices.forEach((entry,i)=>{
    const option=document.createElement('div');option.id=`command-option-${i}`;option.dataset.command=entry.name;
    option.setAttribute('role','option');option.setAttribute('aria-selected',String(i===commandChoice));
    const name=document.createElement('code');name.textContent='\\'+entry.name;
    const label=document.createElement('span');label.textContent=locale==='en'||entry.label===entry.name?t(entry.category):mathLabel(entry);
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
const chemicalStates=new Map<MathNode,{source:string;valid:boolean}>();
function intrinsicMathLayout(editor:EditorModel):{name:string;numbered:boolean;count:number}|null {
  if(editor.root.items.length!==1)return null;
  const node=editor.root.items[0];if(typeof node==='string')return null;
  if(node.type==='numcases'||node.type==='subnumcases'){
    const body=node.regions[1].items[0],rows=body&&typeof body!=='string'?body.rows??1:1;
    return {name:node.type,numbered:true,count:node.type==='subnumcases'?1:rows};
  }
  if(node.type!=='source-tex')return null;
  const source=editing&&editor===model&&editor.cursor.region===node.regions[0].id?node.regions[0].items.join(''):chemicalStates.get(node)?.source??node.regions[0].items.join('');
  const bounds=standaloneMathEnvironmentBounds(source);if(!bounds)return null;
  return {name:bounds.name,numbered:bounds.numbered!==false,count:bounds.numbered===false?0:equationNumbering(source).count};
}
const isChemical=(node:MathNode)=>node.type==='chem-ce'||node.type==='chem-pu';
async function validateChemistry():Promise<void>{
  const live=new Set<MathNode>();
  for(const editor of flow?.entries().map(e=>e.model)||[model])for(const node of editor.nodes.values()){
    if(!isChemical(node)&&node.type!=='source-tex'&&node.type!=='case-text')continue;
    live.add(node);
    if(editing && editor===model && editor.cursor.region===node.regions[0].id)continue;
    const source=structureTex(node,r=>regionTex(r,editor,false));
    if(chemicalStates.get(node)?.source===source)continue;
    let valid=true;
    try {
      const output=await MathJax.tex2chtmlPromise(node.type==='case-text'?`\\textnormal{${node.regions[0].items.join('')}}`:source,{display:false});
      valid=!output.querySelector('mjx-merror');
    } catch {valid=false;}
    chemicalStates.set(node,{source,valid});
  }
  for(const id of chemicalStates.keys())if(!live.has(id))chemicalStates.delete(id);
}
function chemicalTex(node:MathNode,editor=model,isEditing=editing):string {
  const child=node.regions[0],source=structureTex(node,r=>regionTex(r,editor,false));
  if(!child.items.length)return regionTex(child,editor,isEditing);
  if(isEditing && editor.cursor.region===child.id || chemicalStates.get(node)?.source!==source || !chemicalStates.get(node)?.valid)
    return `\\mathrm{${regionTex(child,editor,isEditing)}}`;
  return `\\class{math-region region-${child.id}}{${source}}`;
}
function sourceTex(node:MathNode,editor:EditorModel,isEditing:boolean):string {
  const child=node.regions[0],state=chemicalStates.get(node),raw=child.items.join('');
  let textContext=false,ancestor=editor.parents.get(child.id);
  while(ancestor){if(ancestor.node.type==='numbered-cases-body'&&ancestor.childIndex%2===1){textContext=true;break;}ancestor=editor.parents.get(ancestor.region.id);}
  const source=node.type==='case-text'&&!textContext?`\\textnormal{${raw}}`:raw;
  // Known MathJax syntax can still be displayed even when the editing grammar
  // cannot represent it. Entering that fragment reveals its exact source.
  const content=isEditing&&editor.cursor.region===child.id||!state?.valid||state.source!==(node.type==='case-text'?structureTex(node,r=>regionTex(r,editor,false)):source)?regionTex(child,editor,isEditing):`\\class{math-region region-${child.id}}{${source}${textContext?'':'\n'}}`;
  return `\\class{${node.type==='case-text'?'math-text-region':'math-source-region'}}{${content}}`;
}

function regionTex(region:Region,editor=model,isEditing=editing):string {
  const parent=editor.parents.get(region.id),parentType=parent?.node.type;
  // A numbered-cases body is an alignment preamble, not a grouped math atom.
  // Class wrappers around the complete `a&b\\c&d` would hide its separators
  // from MathJax. Keep markers on each cell so row editing still finds the grid.
  if((parentType==='numcases'||parentType==='subnumcases')&&parent?.childIndex===1&&region.items.length===1){
    const body=region.items[0];
    if(typeof body!=='string'&&body.type==='numbered-cases-body'){
      const columns=body.columns??2,cells=body.regions.map(cell=>`\\class{structure-node structure-${body.id}}{${regionTex(cell,editor,isEditing)}}`);
      return Array.from({length:cells.length/columns},(_,index)=>cells.slice(index*columns,(index+1)*columns).join('&')).join('\\\\');
    }
  }
  const descriptive=parentType==='text-normal'||parentType==='source-tex'||parentType==='case-text';
  const active = isEditing && editor.cursor.region === region.id;
  const [start, end] = active ? editor.range : [0, 0];
  let tex = '';
  region.items.forEach((item, i) => {
    if (active && editor.cursor.offset === i) tex += caretTex;
    const child=(r:Region)=>regionTex(r,editor,isEditing);
    const content = typeof item === 'string' ? (descriptive?textNormal(item==='\n'||item==='\r'?'↵':item,true):texChar(item)) : item.type==='source-tex'||item.type==='case-text'?sourceTex(item,editor,isEditing):item.type==='text-normal'?child(item.regions[0]):isChemical(item)?chemicalTex(item,editor,isEditing):structureTex(item, child);
    const selection = active && i >= start && i < end ? ' math-selected' : '';
    const structureMarker=typeof item==='string' || item.atom?'':` structure-node structure-${item.id}`;
    tex += `\\class{math-item item-${region.id}-${i}${selection}${structureMarker}}{${content}}`;
  });
  if (active && editor.cursor.offset === region.items.length) tex += caretTex;
  // A space has no glyph height: its CSS minimum height grows below the baseline.
  // Use a hidden text digit so MathJax measures the placeholder in the text font.
  if (!region.items.length) tex += descriptive?'\\class{math-placeholder text-placeholder}{0}':placeholderTex;
  const result=`\\class{math-region region-${region.id}${active?' math-active-region':''}}{${tex}}`;
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
  input.setAttribute('aria-label',t('Edit')+' '+mathRegionLabel(model.current.label));
}
function update(sync = true) {
  syncCommands();
  try { sessionStorage.setItem(mathStateKey,model.snapshot()); } catch { /* Editing also works without storage. */ }
  if (sync) syncInput();
  const pending=model.pendingFont?catalog.find(d=>d.type===model.pendingFont)?.command:null;
  elementById('pendingFontHint',HTMLElement).textContent=editing&&pending&&locale==='en'?`${pending}: applies to the next letter or digit. Use arrows or Backspace to cancel.`:editing&&pending?`\\${preferredMathCommand(pending.slice(1))}：仅作用于下一个字母或数字；方向键或 Backspace 取消。`:'';
  if(flow?.syncMath)flow.syncMath();else flow?.persist();
  const layout=elementById('formulaLayout',HTMLSelectElement);
  const intrinsic=intrinsicMathLayout(model);
  layout.disabled=!formula.isConnected||!!intrinsic;layout.value=intrinsic||flow?.isDisplay(formula)?'display':'inline';
  layout.title=intrinsic?t('This environment defines its own display layout and numbering.'):'';
  const sourceButton=document.getElementById('formulaSourceButton') as HTMLButtonElement|null;
  if(sourceButton)sourceButton.disabled=!formula.isConnected||!!flow?.readOnly;
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
    item.setAttribute('title',locale==='en'?'This command does not change this character’s style under the default unicode-math mapping. Input and export are preserved.':warning.message);
    item.setAttribute('aria-invalid','true');
  }
  const active=warnings.find(w=>w.region===model.cursor.region && (w.index===model.cursor.offset || w.index===model.cursor.offset-1));
  fontHint.textContent=locale==='en'?(warnings.length?'Some style commands do not change these characters under the default unicode-math mapping. Marked with a red underline; input and export are preserved.':''):active?.message || (warnings.length?`${warnings.length} 处数学样式命令未作用于字符（按 unicode-math 默认映射），已标红线；悬停可查看原因。输入不受影响。`:'');
}
function begin(id:string, offset:number, anchor = offset) {
  if(flow?.readOnly)return;
  model.pendingFont=undefined;
  if (!editing) sessionStart = model.snapshot();
  editing = true; model.setCursor(id, offset, anchor);
  input.hidden = false; syncInput(); input.focus({preventScroll:true}); update();
}
function finish(cancel = false) {
  if (!editing) return;
  // A host-driven switch can hide the textarea before its native blur or
  // compositionend arrives. Commit to the old model before activating another.
  if (composing) { composing = false; if (!cancel) acceptInput(); }
  inputEdit = null;
  editing = false;
  model.pendingFont=undefined;
  if (cancel && sessionStart) { model.record(); model.restore(sessionStart); }
  sessionStart = null; input.hidden = true; update();
}
function insertStructure(type:string) {
  if(flow?.readOnly)return;
  if (composing) { composing = false; acceptInput(); }
  if (!editing && flow)flow.insertFormula();
  else if (!editing) begin(model.cursor.region, model.cursor.offset, model.cursor.anchor);
  if(palette.find(entry=>entry.type===type)?.atom)model.insertSymbol(type);else model.insertStructure(type);
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
  nav.className='structure-categories';nav.setAttribute('aria-label',t('结构分类'));board.append(nav);
  const visible=palette.filter(entry=>!entry.hidden&&!entry.legacy);
  const alphabets=['拉丁字母','希腊字母','数字'];
  const categoryOf=(entry:typeof visible[number])=>alphabets.includes(entry.category)?'字母与数字':entry.category;
  const categories=[...new Set(['字母与数字',...visible.filter(entry=>entry.category!=='文字').map(categoryOf)])];
  categories.forEach(category=>{
    const tab=document.createElement('button');tab.dataset.category=category;tab.textContent=t(category);tab.setAttribute('aria-pressed','false');nav.append(tab);
    const panel=document.createElement('div');panel.className='structure-group';panel.dataset.group=category;panel.setAttribute('role','group');panel.setAttribute('aria-label',t(category));
    const rows=new Map<string,HTMLElement>();
    if(category==='字母与数字')for(const name of alphabets){
      const row=document.createElement('div');row.className='alphabet-row';
      const label=document.createElement('span');label.className='alphabet-label';label.textContent=t(name);
      const keys=document.createElement('div');keys.className='alphabet-keys';keys.setAttribute('role','group');keys.setAttribute('aria-label',t(name));
      row.append(label,keys);panel.append(row);rows.set(name,keys);
    }
    visible.filter(entry=>categoryOf(entry)===category && (!entry.variantOf || entry.variantOf===entry.type)).forEach(entry=>{
      const card=document.createElement('button');card.dataset.insert=entry.type;card.className='structure-card';card.setAttribute('aria-label',t('Insert')+' '+mathLabel(entry));
      card.title=mathLabel(entry)+' · '+(entry.command?entry.command+' · ':'')+(entry.font?t('Apply this style to the selection, or type in this style'):(entry.labels||[]).map(mathRegionLabel).join(' / '));
      if(entry.letter)card.title=mathLabel(entry)+' · '+t('Insert this letter; right-click for available styles');
      const coverage=entry.font?fontPresentation(entry.command)?.coverage:undefined;
      if(coverage)card.title+=' · '+coverage;
      if(entry.operator)card.title=mathLabel(entry)+' · \\'+entry.operatorCommand+' · '+t('Insert the operator; use ^ / _ or right-click to add limits');
      if(entry.atom || entry.font || entry.category==='函数名称')card.classList.add('compact-card');
      if(entry.variantOf){card.title+=' · '+t('Right-click for variants');card.setAttribute('aria-haspopup','menu');card.setAttribute('aria-expanded','false');}
      const sample=entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>placeholderTex));
      const preview=document.createElement('span');preview.className='structure-preview';preview.setAttribute('aria-hidden','true');preview.textContent='\\(\\displaystyle '+sample+'\\)';
      const label=document.createElement('span');label.className='structure-label';label.textContent=mathLabel(entry);card.append(preview,label);
      if(category==='化学与单位'){
        card.classList.add('chemical-card');
        const command=document.createElement('code');command.textContent=entry.command+'{…}';card.append(command);
      }
      (rows.get(entry.category)??panel).append(card);
    });
    board.append(panel);
  });
  const textButton=document.createElement('button');textButton.dataset.insert='text-normal';textButton.className='insert-text';textButton.textContent=t('Aa Text');textButton.title=t('Insert descriptive text')+' · \\textnormal{…}';textButton.setAttribute('aria-label',t('Insert descriptive text'));nav.append(textButton);
  elementById('structureCount', HTMLElement).textContent=t('Right-click for variants · {count} categories',{count:categories.length});
  document.querySelectorAll<HTMLElement>('[data-count-category]').forEach(cell=>{cell.textContent=t('{count} presets; hover for exact syntax',{count:catalog.filter(entry=>entry.category===cell.dataset.countCategory).length});});
  showCategory(categories[0]);
}
const variantMenu = document.createElement('div');
variantMenu.className='variant-menu';variantMenu.id='variantMenu';variantMenu.hidden=true;
variantMenu.setAttribute('role','menu');document.body.append(variantMenu);
let variantTrigger:HTMLElement|null=null, variantNodeId:string|undefined, variantCellId:string|undefined;
let variantLetter:{region:string;index:number}|null=null;
const sourceDialog=document.createElement('dialog');
sourceDialog.id='formulaSourceDialog';sourceDialog.className='document-unsaved-dialog formula-source-dialog';
const sourceTitle=document.createElement('h2');sourceTitle.id='formulaSourceTitle';sourceTitle.textContent=t('Edit LaTeX source');sourceDialog.setAttribute('aria-labelledby',sourceTitle.id);
const sourceHelp=document.createElement('p');sourceHelp.textContent=t('Edit the existing source and convert it back to editable math. Unsupported fragments keep their source.');
const sourceInput=document.createElement('textarea');sourceInput.id='formulaSourceInput';sourceInput.setAttribute('aria-label',t('LaTeX source'));sourceInput.spellcheck=false;
const sourceActions=document.createElement('div');sourceActions.className='document-unsaved-actions';
const sourceCancel=document.createElement('button');sourceCancel.type='button';sourceCancel.textContent=t('Cancel');
const sourceApply=document.createElement('button');sourceApply.type='button';sourceApply.dataset.choice='save';sourceApply.textContent=t('Apply and convert');
sourceActions.append(sourceCancel,sourceApply);sourceDialog.append(sourceTitle,sourceHelp,sourceInput,sourceActions);document.body.append(sourceDialog);
let sourceOwner:HTMLElement|undefined;
function openFormulaSource(owner=formula){
  if(flow?.readOnly||!owner.isConnected)return;
  if(owner!==formula)flow?.enter(owner,'end');
  closeVariantMenu();flow?.syncMath?.();sourceOwner=owner;
  sourceInput.value=flow?.getFormulaSource?.(owner)??model.exportLatex();
  sourceDialog.showModal();sourceInput.focus();sourceInput.setSelectionRange(0,0);
}
sourceCancel.addEventListener('click',()=>sourceDialog.close());
sourceDialog.addEventListener('close',()=>{if(sourceOwner?.isConnected){if(flow)flow.enter(sourceOwner,'end');else begin(model.root.id,model.root.items.length);}sourceOwner=undefined;});
sourceApply.addEventListener('click',()=>{
  if(!sourceOwner?.isConnected)return;
  if(flow?.replaceFormulaSource)flow.replaceFormulaSource(sourceOwner,sourceInput.value);
  else{model.record();model.restore(convertMath(sourceInput.value).snapshot());}
  inputEdit=null;sourceDialog.close();update();
});
const sourceButton=document.createElement('button');sourceButton.id='formulaSourceButton';sourceButton.type='button';sourceButton.textContent='LaTeX';sourceButton.title=t('Edit LaTeX source');sourceButton.setAttribute('aria-label',t('Edit LaTeX source'));
const layoutControl=document.getElementById('formulaLayout');
(layoutControl?.closest('.document-actions')??document.getElementById('mathPanel'))?.append(sourceButton);
sourceButton.addEventListener('pointerdown',event=>event.preventDefault());sourceButton.addEventListener('click',()=>openFormulaSource());
function appendSourceMenu(owner:HTMLElement,x:number,y:number){
  if(variantMenu.hidden){variantMenu.replaceChildren();variantMenu.setAttribute('aria-label',t('Formula'));}
  const option=document.createElement('button');option.type='button';option.dataset.editFormulaSource=owner.dataset.mathId??'';option.textContent=t('Edit LaTeX source');option.setAttribute('role','menuitem');variantMenu.append(option);
  variantMenu.hidden=false;const rect=variantMenu.getBoundingClientRect();variantMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';variantMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
}
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
  variantMenu.setAttribute('aria-label',t('Formula variants'));
  if(node && definition?.operator){
    definition.scriptSlots!.forEach((slot,i)=>{
      const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
      option.dataset.scriptSlot=slot;option.textContent=t(node.regions.some(r=>r.slot===slot)?'Remove':'Add')+' '+t(definition.scriptLabels![i]);variantMenu.append(option);
    });
    if(entries.length){const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
  }
  if(node && (definition?.matrixEnvironment || definition?.rowEnvironment)){
    const matrix=Boolean(definition.matrixEnvironment);
    const cell=model.tableCell(node.id,cellRegionId)||model.tableCell(node.id)||model.tableCell(node.id,node.regions[0].id);
    if(!cell)return;
    variantCellId=node.regions[cell.index].id;
    const heading=document.createElement('div');heading.className='menu-heading';
    heading.textContent=t(matrix?'Matrix {rows} × {columns} · row {row}, column {column}':'{rows} rows · current row {row}',{rows:node.rows!,columns:node.columns!,row:cell.row+1,column:cell.column+1});variantMenu.append(heading);
    for(const [action,label] of [['rowBefore','在此行上方插入行'],['rowAfter','在此行下方插入行'],['columnBefore','在此列左侧插入列'],['columnAfter','在此列右侧插入列'],['deleteRow','删除此行'],['deleteColumn','删除此列']]){
      if(!matrix && action.toLowerCase().includes('column'))continue;
      const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
      option.dataset.matrixAction=action;option.textContent=t(label);
      option.disabled=(action==='deleteRow' && node.rows===1)||(action==='deleteColumn' && node.columns===1);
      if(option.disabled)option.title=t(matrix?'Keep at least one row and column':'Keep at least one row');
      variantMenu.append(option);
    }
    if(entries.length){const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
  }
  for(const entry of entries){
    const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
    option.dataset.variant=entry.type;
    const sample=(entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>placeholderTex)))!.trim();
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
    }).catch(()=>{glyph.textContent='—';glyph.title=t('预览暂不可用');});
    if(entry.font){const coverage=fontPresentation(entry.command)?.coverage;if(coverage)option.title+=' · '+coverage;}
    if(node){
      option.setAttribute('role','menuitemradio');option.setAttribute('aria-checked',String(entry.type===node.type || (!!entry.glyphKey&&entry.glyphKey===definition?.glyphKey) || (!!entry.tex&&entry.tex===definition?.tex) || (node.type==='matrix3' && entry.type==='matrix')));
      option.disabled=!!node.id&&!model.canSwitchVariant(node.id,entry.type);
      if(option.disabled){option.title=t('先移走超出目标尺寸的单元格内容');}
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
function appendNumberingMenu(owner:HTMLElement,x:number,y:number){
  if(!flow?.isDisplay(owner))return;
  const entry=flow.entries().find(entry=>entry.element===owner);if(entry&&intrinsicMathLayout(entry.model))return;
  if(variantMenu.hidden){MathJax.typesetClear([variantMenu]);variantMenu.replaceChildren();variantMenu.setAttribute('aria-label',t('Display'));}
  else {const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
  for(const [value,label] of [['true','编号'],['false','不编号']]){
    const option=document.createElement('button');option.type='button';option.dataset.numbered=value;
    option.dataset.formulaId=owner.dataset.mathId;option.textContent=t(label);option.setAttribute('role','menuitemradio');
    option.setAttribute('aria-checked',String(flow.isNumbered(owner)===(value==='true')));variantMenu.append(option);
  }
  variantMenu.hidden=false;const rect=variantMenu.getBoundingClientRect();
  variantMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';
  variantMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
}
variantMenu.addEventListener('click',event=>{
  const source=eventElement(event).closest<HTMLButtonElement>('[data-edit-formula-source]');
  if(source){const owner=flow?.entries().find(e=>e.element.dataset.mathId===source.dataset.editFormulaSource)?.element??formula;openFormulaSource(owner);return;}
  const numbering=eventElement(event).closest<HTMLButtonElement>('[data-numbered]');
  if(numbering){const owner=flow?.entries().find(e=>e.element.dataset.mathId===numbering.dataset.formulaId)?.element;
    if(owner)flow?.setNumbered(owner,numbering.dataset.numbered==='true');closeVariantMenu();return;}
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
let boardTypeset:Promise<void>|undefined;
function positionInput() {
  if (!editing) return;
  const caret = formula.querySelector('.math-caret'); if (!caret) return;
  const rect = caret.getBoundingClientRect(), box = preview.getBoundingClientRect();
  input.style.left = (rect.left - box.left - preview.clientLeft + preview.scrollLeft) + 'px';
  input.style.top = (rect.top - box.top - preview.clientTop + preview.scrollTop) + 'px';
  positionCommands();
}
function render():Promise<void> {
  if (!window.ready) return Promise.resolve();
  // Exports share the in-flight repaint rather than snapshotting stale math.
  return rendering??=renderCurrent().finally(()=>{rendering=undefined;});
}
async function renderCurrent() {
  const stage = document.createElement('div'); stage.id = 'renderStage'; stage.setAttribute('aria-hidden', 'true');
  stage.style.fontSize=getComputedStyle(elementById('textFlow',HTMLElement)).fontSize;
  document.body.append(stage);
  try {
    lastRenderFailure=undefined;
    // ES modules can finish loading after MathJax's initial page scan.
    boardTypeset??=MathJax.typesetPromise([...document.querySelectorAll<HTMLElement>('.structure-preview')].filter(el=>!el.querySelector('mjx-container')));
    await boardTypeset;
    let rendered;
    do {
      rendered = revision;
      await validateChemistry();
      MathJax.typesetClear([stage]);
      const edge = (side:string) => `\\class{math-boundary boundary-${side}}{\\vphantom{Xg}\\kern0.15em}`;
      let equationNumber=0;
      for(const entry of flow?.entries()||[{element:formula,model}]){
        const intrinsic=intrinsicMathLayout(entry.model),display=flow?.isDisplay(entry.element)||!!intrinsic;
        const numbered=intrinsic?intrinsic.numbered:display&&flow?.isNumbered(entry.element),environment=numbered?'equation':'equation*';
        const firstNumber=equationNumber;
        if(numbered)equationNumber+=intrinsic?.count??1;
        const label=entry.element.dataset.texLabel;
        const source=(intrinsic?'\\[':display?`\\begin{${environment}}`:'\\(')+edge('start')+regionTex(entry.model.root,entry.model,editing&&entry.model===model)+edge('end')+(intrinsic?'\\]':display?`\\end{${environment}}`:'\\)');
        const width=elementById('textFlow',HTMLElement).clientWidth;
        const cacheKey=(label||'')+(display?`${equationNumber}:${width}:`:'')+source;
        if(renderedSources.get(entry.element)===cacheKey)continue;
        MathJax.typesetClear([stage]);stage.style.width=display?width+'px':'auto';stage.textContent=source;
        // Let MathJax generate the tag, seeded by this equation's document order.
        // Cursor redraws must not increment numbering; moved equations invalidate the cache.
        if(display)MathJax.texReset(firstNumber);
        await MathJax.typesetPromise([stage]);
        if(rendered!==revision)break;
        const failed=stage.querySelector('mjx-merror');
        if(failed)throw new Error(failed.textContent || t('MathJax 无法排版'));
        MathJax.typesetClear([entry.element]);entry.element.replaceChildren(...stage.childNodes);renderedSources.set(entry.element,cacheKey);
      }
    } while (rendered !== revision);
    error.textContent = [...chemicalStates].some(([node,state])=>isChemical(node)&&!state.valid)?t('化学语法尚未完整，已保留源码；点击该区域可继续编辑。'):'';
    preview.querySelectorAll<HTMLElement>('.math-source-region').forEach(element=>{element.title=t('Click to edit this fragment’s LaTeX source');});
    annotateFontWarnings(); positionInput();
  } catch (err) { lastRenderFailure=err;error.textContent = t('公式排版失败：') + String(err); }
  finally { MathJax.typesetClear([stage]); stage.remove(); }
}
const renderedSources=new WeakMap<HTMLElement,string>();

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
preview.addEventListener('pointerdown', event => {
  if(flow?.readOnly)return;
  const target=eventElement(event).closest<HTMLElement>('.inline-formula');if(!target)return;
  if(eventElement(event).closest('mjx-labels')){event.preventDefault();event.stopPropagation();document.dispatchEvent(new CustomEvent('edit-tex-label',{detail:target.dataset.mathId}));return;}
  if(event.button!==0){event.preventDefault();return;}
  if(target!==formula||!editing)flow?.enter(target,'end');
  const point = hit(eventElement(event), event.clientX) || {id:model.root.id,offset:model.root.items.length};
  event.preventDefault(); event.stopPropagation();
  const anchor = event.shiftKey && editing && model.cursor.region === point.id ? model.cursor.anchor : point.offset;
  begin(point.id, point.offset, anchor);
  drag = {id: point.id, anchor, x: event.clientX, y: event.clientY};
  formula.setPointerCapture(event.pointerId);
});
preview.addEventListener('pointermove', event => {
  if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
  const target = document.elementFromPoint(event.clientX, event.clientY); if (!target) return;
  const point = hit(target, event.clientX);
  if (point?.id === drag.id) { model.setCursor(point.id, point.offset, drag.anchor); update(); }
});
preview.addEventListener('pointerup', () => { drag = null; });
preview.addEventListener('pointercancel', () => { drag = null; });
preview.addEventListener('click', event => { if(eventElement(event).closest('.inline-formula')){event.preventDefault();event.stopPropagation();} });
preview.addEventListener('contextmenu',event=>{
  if(flow?.readOnly)return;
  const owner=eventElement(event).closest<HTMLElement>('.inline-formula');if(!owner)return;
  if(owner!==formula)flow?.enter(owner,'end');
  closeVariantMenu();
  const target=eventElement(event),rElement=target.closest('.math-region'),iElement=target.closest<HTMLElement>('.math-item');
  if(rElement&&iElement){
    const rid=regionId(rElement),index=itemIndex(iElement,rid),item=model.regions.get(rid)?.items[index];
    const def=typeof item==='string'?symbols.find(d=>d.letter===item&&d.variantOf===d.type):symbols.find(d=>d.type===item?.type);
    if(def?.letter&&model.parents.get(rid)?.node.type!=='text-normal'){
      event.preventDefault();event.stopPropagation();
      openVariantMenu(iElement,event.clientX,event.clientY,typeof item==='string'?{id:'',type:def.type,atom:true,regions:[]}:item!);
      variantLetter={region:rid,index};appendNumberingMenu(owner,event.clientX,event.clientY);appendSourceMenu(owner,event.clientX,event.clientY);return;
    }
  }
  let element:HTMLElement|null=eventElement(event).closest<HTMLElement>('.structure-node');
  while(element && formula.contains(element)){
    const id=[...element.classList].find(name=>/^structure-n\d+$/.test(name))?.slice(10);
    const node=id?model.nodes.get(id):undefined;
    const definition=catalog.find(entry=>entry.type===node?.type);
    if(node && !definition?.font && (definition?.operator || definition?.variantOf || definition?.matrixEnvironment || definition?.rowEnvironment)){
      const regionElement=eventElement(event).closest<HTMLElement>('.math-region');
      event.preventDefault();event.stopPropagation();openVariantMenu(element,event.clientX,event.clientY,node,regionElement?regionId(regionElement):undefined);appendNumberingMenu(owner,event.clientX,event.clientY);appendSourceMenu(owner,event.clientX,event.clientY);return;
    }
    element=element.parentElement?.closest<HTMLElement>('.structure-node') || null;
  }
  event.preventDefault();event.stopPropagation();appendNumberingMenu(owner,event.clientX,event.clientY);appendSourceMenu(owner,event.clientX,event.clientY);
},true);
preview.addEventListener('keydown', event => {
  const target=eventElement(event).closest<HTMLElement>('.inline-formula');if(!target)return;
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flow?.enter(target,'end'); }
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
    const direction=event.key==='ArrowLeft'?-1:1;
    if(!event.shiftKey && model.cursor.region===model.root.id && model.range[0]===model.range[1] && model.cursor.offset===(direction<0?0:model.root.items.length)){
      event.preventDefault();flow?.exit(formula,direction);return;
    }
    event.preventDefault(); model.move(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); model.vertical(event.key === 'ArrowUp' ? -1 : 1);
  } else if (event.key === 'Home' || event.key === 'End') {
    model.pendingFont=undefined;
    event.preventDefault(); model.setCursor(model.cursor.region, event.key === 'Home' ? 0 : model.current.items.length, event.shiftKey ? model.cursor.anchor : undefined);
  } else if (event.key === 'Tab') {
    event.preventDefault(); if(event.shiftKey || !model.commitCommand())model.tab(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    if(model.cursor.region===model.root.id && !model.root.items.length && !model.pendingFont){event.preventDefault();flow?.removeEmpty(formula);return;}
    event.preventDefault(); model.remove(event.key === 'Backspace' ? -1 : 1);
  } else if (event.key === 'Enter' || event.key === 'Escape') {
    if(event.key==='Enter' && model.commitCommand()){event.preventDefault();update();return;}
    event.preventDefault();finish(event.key==='Escape');flow?.exit(formula,1);return;
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
  if (!editing) return;
  inputEdit = {region: model.cursor.region, start: model.range[0], end: model.range[1]};
  composing = true;
  syncCommands();
});
input.addEventListener('compositionend', () => { if (!composing) return; composing = false; acceptInput(); });
document.addEventListener('selectionchange', () => {
  if (!editing || composing || document.activeElement !== input || input.value !== model.projection()) return;
  const start = Array.from(input.value.slice(0, input.selectionStart)).length;
  const end = Array.from(input.value.slice(0, input.selectionEnd)).length;
  const offset = input.selectionDirection === 'backward' ? start : end, anchor = input.selectionDirection === 'backward' ? end : start;
  if (offset !== model.cursor.offset || anchor !== model.cursor.anchor) { model.setCursor(model.cursor.region, offset, anchor); update(false); }
});
input.addEventListener('blur', event => { if(event.relatedTarget instanceof Node && elementById('mathPanel',HTMLElement).contains(event.relatedTarget))return; finish(); });
function clipboardSelection(){
  if(input.value!==model.projection())return;
  const start=Array.from(input.value.slice(0,input.selectionStart)).length,end=Array.from(input.value.slice(0,input.selectionEnd)).length;
  model.setCursor(model.cursor.region,input.selectionDirection==='backward'?start:end,input.selectionDirection==='backward'?end:start);
}
function copyMath(event:ClipboardEvent,cut=false){
  if(!editing||!event.clipboardData||flow?.readOnly)return;
  if(composing){composing=false;acceptInput();}
  clipboardSelection();const [start,end]=model.range;if(start===end)return;
  event.preventDefault();event.stopPropagation();
  const fragment:NativeMathFragment={version:1,kind:'math',snapshot:model.selectionSnapshot()};
  const plain=model.selectionLatex();
  // A cut may delete only after at least its readable representation was written.
  try{event.clipboardData.setData('text/plain',plain);}catch{return;}
  writeNativeClipboard(event.clipboardData,fragment);
  try{const html=plain.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');event.clipboardData.setData('text/html',nativeClipboardHtml(fragment,'<span>'+html+'</span>'));}catch{/* Plain text/custom MIME remain available. */}
  if(cut){model.replace(start,end,'');inputEdit=null;update();}
}
input.addEventListener('copy',event=>copyMath(event));
input.addEventListener('cut',event=>copyMath(event,true));
input.addEventListener('paste',event=>{
  if(!editing||!event.clipboardData||flow?.readOnly)return;
  if(composing){composing=false;acceptInput();}
  clipboardSelection();const data=event.clipboardData,native=readNativeClipboard(data);
  const plain=data.getData('text/plain');
  let imported:EditorModel|undefined,sourceFallback:string|undefined;
  if(native?.kind==='math'){
    imported=new EditorModel();imported.restore(native.snapshot);
  }else if(native?.kind==='document'){
    // Copying a whole formula from prose can use the same native math structure.
    const formulas:{snapshot?:string;texExpression?:string}[]=[],other:string[]=[];
    const walk=(nodes:readonly any[])=>{for(const node of nodes){
      if(node.type==='inline_equation'||node.type==='equation')formulas.push(node);
      else if(typeof node.text==='string'){if(node.text.trim())other.push(node.text);}
      else if(node.type==='p'&&Array.isArray(node.children))walk(node.children);
      else other.push('block');
    }};walk(native.value);
    if(formulas.length===1&&!other.length){
      const formula=formulas[0];
      if(formula.snapshot){imported=new EditorModel();imported.restore(formula.snapshot);}
      else if(formula.texExpression!==undefined){const normalized=normalizeMathSource(formula.texExpression);sourceFallback=normalized?.source??formula.texExpression;imported=(normalized?convertMath(normalized.source):null)??undefined;}
    }
  }
  if(model.rawInput){
    const text=plain||(imported?.exportLatex()??sourceFallback??'');if(!text)return;
    event.preventDefault();event.stopPropagation();model.replace(...model.range,text);
  }else if(imported){
    if(!imported.root.items.length)return;
    event.preventDefault();event.stopPropagation();model.replaceFragment(imported.root.items);
  }else{
    // Use an explicit TeX annotation when available; rendered glyphs alone are
    // never enough to reconstruct the formula's source or structure.
    const annotated=extractClipboardMathHtml(data.getData('text/html'));
    const incoming=sourceFallback??annotated?.source??plain;if(!incoming)return;
    const normalized=normalizeMathSource(incoming),source=normalized?.source??incoming;
    const parsed=normalized?convertMath(source):null;
    event.preventDefault();event.stopPropagation();
    if(parsed)model.replaceFragment(parsed.root.items);else model.insertSourceTex(source);
  }
  inputEdit=null;update();
});
window.addEventListener('resize',()=>{positionInput();update();});
new ResizeObserver(positionInput).observe(preview);
window.mathjaxLoadFailed = () => { error.textContent = t('MathJax 加载失败，请检查网络连接。'); };
window.addEventListener('mathjax-ready',()=>render());
setTimeout(() => { if (!window.ready) error.textContent = t('MathJax 尚未就绪，请检查网络连接。'); }, 10000);
export function mountMathEditor(createHost:DocumentHostFactory){
flow=createHost(elementById('textFlow',HTMLElement),model,{
  activate:(element,editor,edge)=>{
    if(editor!==model||element!==formula){finish();formula.removeAttribute('id');formula=element;formula.id='formula';model=editor;}
    begin(model.root.id,edge==='start'?0:model.root.items.length);
  },
  leave:()=>finish(),change:()=>update(),
  renderForExport:async()=>{
    flow?.syncMath?.();
    await Promise.resolve();
    if(!flow?.entries().length)return;
    if(!window.ready)await new Promise<void>((resolve,reject)=>{
      const ready=()=>{clearTimeout(timeout);resolve();};
      const timeout=setTimeout(()=>{window.removeEventListener('mathjax-ready',ready);reject(Error(t('MathJax is not ready. Please try exporting again after the formulas load.')));},10000);
      window.addEventListener('mathjax-ready',ready,{once:true});
    });
    await render();
    if(lastRenderFailure!==undefined)throw lastRenderFailure;
  }
});
const initial=flow.entries()[0];if(initial){formula=initial.element;formula.id='formula';model=initial.model;}
elementById('formulaLayout',HTMLSelectElement).addEventListener('change',event=>{
  if(flow?.readOnly)return;
  flow?.setDisplay(formula,(event.target as HTMLSelectElement).value==='display');
  input.focus({preventScroll:true});
});
update();
}
