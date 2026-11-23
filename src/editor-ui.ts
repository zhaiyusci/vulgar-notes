import {t,locale,mathLabel,mathRegionLabel} from './i18n';
import {selectMathFont} from './mathjax-document-font';
import {fontPresentation} from './font-diagnostics';
import {textNormal,preferredMathCommand} from './letter-variants';
import type {MathDocumentAdapter,MathEditor,MathEditorHooks,MathEditorOptions,MathSourceEditorContext} from './math-editor';
import {EditorModel, texChar, structureTex, catalog, symbols, type Region, type MathNode, type CommandCandidate} from './editor-model';
import {normalizeMathSource} from './tex-import';
import {convertMath,convertTypedColorCommand} from './tex-convert';
import {mathClipboard} from './math-clipboard';
import {standaloneMathEnvironmentBounds} from './tex-display-environment';
import {equationNumbering} from './math-equation-numbering';
import {formulaLayouts} from './formula-layouts';
import {createMathColorControl} from './math-color-control';
const palette=[...catalog,...symbols];
let instanceNumber=0;
/** Mount explicit elements. Importing this module does not access or create DOM. */
export function createMathEditor(options:MathEditorOptions):MathEditor {
  const elements=options.elements,document=elements.preview.ownerDocument,window=document.defaultView!;
  const {HTMLElement,HTMLTextAreaElement,HTMLSelectElement,Node,Element}=window;
  function eventElement(event:Event):Element {
    const target=event.target;
    if(target instanceof Element)return target;
    if(target instanceof Node&&target.parentElement)return target.parentElement;
    return document.documentElement;
  }
  const overlayRoot=elements.overlayRoot??document.body;
  const instance=++instanceNumber;
  const idFor=(id:string)=>document.getElementById(id)?id+'-'+instance:id;
  const formulaId=elements.formula.id&&document.getElementById(elements.formula.id)===elements.formula?elements.formula.id:idFor('formula');
  const events=new window.AbortController();
  let disposed=false,frame:number|undefined,activeStage:HTMLElement|undefined;
  const ownedBoardNodes:HTMLElement[]=[];
  function listen<K extends keyof HTMLElementEventMap>(target:HTMLElement,type:K,listener:(event:HTMLElementEventMap[K])=>unknown,options?:boolean|AddEventListenerOptions):void;
  function listen<K extends keyof DocumentEventMap>(target:Document,type:K,listener:(event:DocumentEventMap[K])=>unknown,options?:boolean|AddEventListenerOptions):void;
  function listen<K extends keyof WindowEventMap>(target:Window,type:K,listener:(event:WindowEventMap[K])=>unknown,options?:boolean|AddEventListenerOptions):void;
  function listen(target:EventTarget,type:string,listener:EventListener,options?:boolean|AddEventListenerOptions):void;
  function listen(target:EventTarget,type:string,listener:EventListener,options?:boolean|AddEventListenerOptions):void {
    target.addEventListener(type,listener,{...(typeof options==='boolean'?{capture:options}:options),signal:events.signal});
  }
  let model=options.initialModel??new EditorModel(),editing=false,composing=false,sessionStart:string|null=null;
  try{const saved=options.draft?.read();if(saved)model.restore(saved);}catch{/* A failed optional draft must not prevent mounting. */}
  const initialModel=model;
  let revision = 0, rendering:Promise<void>|undefined, scheduled = false;
  let lastRenderFailure:unknown;
  let formula = elements.formula;formula.id=formulaId;
  const preview = elements.preview;
  let flow:MathDocumentAdapter|undefined;
  let colorControl:ReturnType<typeof createMathColorControl>|undefined;
  const input = elements.input, error = elements.error;
  const fontHint=document.createElement('p');
  fontHint.id=idFor('fontHint');fontHint.className='math-font-hint';fontHint.setAttribute('role','status');fontHint.setAttribute('aria-live','polite');
  error.after(fontHint);
  // Editing decorations never enter TeX: even a zero-width kern changes a
  // single-character base into an mrow and changes accent/script placement.
  const caret=document.createElement('span');caret.className='math-caret';caret.setAttribute('aria-hidden','true');caret.hidden=true;
  let decorated:HTMLElement[]=[];
  const placeholderTex='\\class{math-placeholder}{\\phantom{0}}';
  const commandMenu=document.createElement('div');
  commandMenu.id=idFor('commandMenu');commandMenu.className='command-menu';commandMenu.hidden=true;
  commandMenu.setAttribute('role','listbox');commandMenu.setAttribute('aria-label',t('LaTeX 命令候选'));overlayRoot.append(commandMenu);
  input.setAttribute('aria-controls',commandMenu.id);input.setAttribute('aria-autocomplete','list');
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
      const option=document.createElement('div');option.id=commandMenu.id+`-option-${i}`;option.dataset.command=entry.name;
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
    if(caret.hidden)return;
    const rect=caret.getBoundingClientRect();
    commandMenu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-commandMenu.offsetWidth-8))+'px';
    commandMenu.style.top=Math.max(8,rect.bottom+8+commandMenu.offsetHeight>window.innerHeight?rect.top-commandMenu.offsetHeight-8:rect.bottom+8)+'px';
  }
  listen(commandMenu,'pointerdown',event=>event.preventDefault());
  listen(commandMenu,'click',event=>{
    if(flow?.readOnly||!editing){commandMenu.hidden=true;return;}
    const option=eventElement(event).closest<HTMLElement>('[data-command]');if(!option)return;
    model.commitCommand(true,option.dataset.command);inputEdit=null;input.focus({preventScroll:true});update();
  });
  listen(document,'scroll',positionCommands,true);
  const chemicalStates=new Map<MathNode,{source:string;valid:boolean}>();
  function intrinsicMathLayout(editor:EditorModel):{name:string;numbered:boolean;count:number}|null {
    const layout=editor.formulaLayout()?.formula;
    if(layout){
      const node=editor.root.items[0] as MathNode;
      const body=layout.kind==='cases'?node.regions[1].items[0]:node;
      const count=layout.numbering==='none'?0:layout.numbering==='rows'&&typeof body!=='string'?(body?.rows??1):1;
      return {name:layout.environment,numbered:count>0,count};
    }
    if(editor.root.items.length!==1)return null;
    const node=editor.root.items[0];if(typeof node==='string')return null;
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
      if(disposed)return;chemicalStates.set(node,{source,valid});
    }
    for(const id of chemicalStates.keys())if(!live.has(id))chemicalStates.delete(id);
  }
  function chemicalTex(node:MathNode,editor=model,isEditing=editing):string {
    const child=node.regions[0],source=structureTex(node,r=>regionTex(r,editor,false));
    if(!child.items.length)return regionTex(child,editor,isEditing);
    if(isEditing && editor.cursor.region===child.id || chemicalStates.get(node)?.source!==source || !chemicalStates.get(node)?.valid)
      return regionTex(child,editor,isEditing);
    return `\\class{math-region region-${child.id}}{${source}}`;
  }
  function sourceTex(node:MathNode,editor:EditorModel,isEditing:boolean):string {
    const child=node.regions[0],state=chemicalStates.get(node),raw=child.items.join('');
    const parent=editor.parents.get(child.id),cell=parent&&editor.parents.get(parent.region.id);
    // Only a direct condition cell is in text mode. A color/math wrapper in
    // that cell opens its own math context, just as the cases renderer does.
    const textContext=node.type==='case-text'&&cell?.node.type==='numbered-cases-body'&&cell.childIndex%2===1;
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
    if(parent&&editor.formulaLayout()?.formula?.kind==='cases'&&parent.node===editor.root.items[0]&&parent.childIndex===1&&region.items.length===1){
      const body=region.items[0];
      if(typeof body!=='string'&&['numbered-cases-body','formula-cases-body'].includes(body.type)){
        const columns=body.columns??2,cells=body.regions.map((cell,index)=>{
          const child=cell.items.length===1?cell.items[0]:undefined;
          const textCondition=child&&typeof child!=='string'&&child.type==='case-text';
          const content=`\\class{structure-node structure-${body.id}}{${regionTex(cell,editor,isEditing)}}`;
          return body.type==='numbered-cases-body'&&index%columns===1&&!textCondition?'$'+content+'$':content;
        });
        return Array.from({length:cells.length/columns},(_,index)=>cells.slice(index*columns,(index+1)*columns).join('&')).join('\\\\');
      }
    }
    const code=parentType==='source-tex'||parentType==='chem-ce'||parentType==='chem-pu';
    const descriptive=code||parentType==='text-normal'||parentType==='case-text';
    let tex = '',command=false;
    region.items.forEach((item, i) => {
      const child=(r:Region)=>regionTex(r,editor,isEditing);
      // Pending command characters stay code wherever the caret moves. This is
      // only their editing presentation; committing still inserts normal math.
      command=!descriptive&&typeof item==='string'&&(item==='\\'||command&&/^[a-zA-Z]$/.test(item));
      const content = typeof item === 'string' ? (descriptive?textNormal(item==='\n'||item==='\r'?'↵':item,true):command?`\\class{math-code}{\\texttt{${textNormal(item,true)}}}`:texChar(item)) : item.type==='source-tex'||item.type==='case-text'?sourceTex(item,editor,isEditing):item.type==='text-normal'?child(item.regions[0]):isChemical(item)?chemicalTex(item,editor,isEditing):structureTex(item, child);
      const structureMarker=typeof item==='string' || item.atom?'':` structure-node structure-${item.id}`;
      tex += `\\class{math-item item-${region.id}-${i}${structureMarker}}{${content}}`;
    });
    // A space has no glyph height: its CSS minimum height grows below the baseline.
    // Use a hidden text digit so MathJax measures the placeholder in the text font.
    if (!region.items.length) tex += descriptive?'\\class{math-placeholder text-placeholder}{0}':placeholderTex;
    const result=`\\class{math-region region-${region.id}${code?' math-code':''}}{${tex}}`;
    return code?`\\texttt{${result}}`:descriptive?`\\textnormal{${result}}`:result;
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
    if(disposed)return;
    colorControl?.update();
    syncCommands();
    try { options.draft?.write(model.snapshot()); } catch { /* Editing also works without storage. */ }
    if (sync) syncInput();
    decorateEditing();
    const pending=model.pendingFont?catalog.find(d=>d.type===model.pendingFont)?.command:null;
    elements.pendingFontHint.textContent=editing&&pending&&locale==='en'?`${pending}: applies to the next letter or digit. Use arrows or Backspace to cancel.`:editing&&pending?`\\${preferredMathCommand(pending.slice(1))}：仅作用于下一个字母或数字；方向键或 Backspace 取消。`:'';
    flow?.syncMath();
    const layout=elements.layout;
    const intrinsic=intrinsicMathLayout(model);
    layout.disabled=!formula.isConnected||!!intrinsic;layout.value=intrinsic||flow?.isDisplay(formula)?'display':'inline';
    layout.title=intrinsic?t('This environment defines its own display layout and numbering.'):'';
      if(defaultSource)defaultSource.button.disabled=!formula.isConnected||!!flow?.readOnly;
    revision++;
    if (!scheduled) {
      scheduled = true;
      frame=window.requestAnimationFrame(() => { frame=undefined;scheduled = false;if(!disposed)void render(); });
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
    closeVariantMenu();
    colorControl?.close();
    if (!editing) return;
    // A host-driven switch can hide the textarea before its native blur or
    // compositionend arrives. Commit to the old model before activating another.
    if (composing) { composing = false; if (!cancel) acceptInput(); }
    inputEdit = null;
    editing = false;
    model.pendingFont=undefined;
    if (cancel && sessionStart && !flow?.isCollaborating?.()) { model.record(); model.restore(sessionStart); }
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
  listen(elements.toolbar,'pointerdown', event => {
    // Preserve the native selection and focus while the user clicks a tool.
    if (eventElement(event).closest<HTMLElement>('button')) event.preventDefault();
  });
  listen(elements.toolbar,'click', event => {
    const button = eventElement(event).closest<HTMLElement>('button[data-insert]');
    if (button?.dataset.insert) insertStructure(button.dataset.insert);
    const category = eventElement(event).closest<HTMLElement>('button[data-category]');
    if (category?.dataset.category) showCategory(category.dataset.category);
  });
  function showCategory(name:string) {
    closeVariantMenu();
    elements.toolbar.querySelectorAll<HTMLElement>('[data-category]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.category===name));
    });
    elements.toolbar.querySelectorAll<HTMLElement>('.structure-group').forEach(panel=>{panel.hidden=panel.dataset.group!==name});
  }
  function buildBoard() {
    const board=elements.toolbar,nav=document.createElement('div');
    nav.className='structure-categories';nav.setAttribute('aria-label',t('结构分类'));board.append(nav);ownedBoardNodes.push(nav);
    const visible=palette.filter(entry=>entry.scope!=='formula'&&!entry.hidden&&!entry.legacy);
    const alphabets=['拉丁字母','希腊字母','数字'];
    const categoryOf=(entry:typeof visible[number])=>alphabets.includes(entry.category)?'字母与数字':entry.category;
    const categories=[...new Set(['字母与数字',...visible.filter(entry=>entry.category!=='文字').map(categoryOf)])];
    const categorySamples:Record<string,string>={
      '字母与数字':'a\\alpha',
      '分式与根式':'\\frac{a}{b}',
      '上下标':'x^{2}',
      '括号与定界符':'\\langle x\\rangle',
      '大型算符':'\\sum',
      '矩阵与多行':'\\left[\\begin{smallmatrix}a&b\\\\c&d\\end{smallmatrix}\\right]',
      '重音与修饰':'\\hat{a}',
      '标注与箭头':'\\overbrace{ab}',
      '运算符号':'+\\times',
      '物理记号':'\\lvert\\psi\\rangle',
      '化学与单位':'\\mathrm{H_2O}',
      '函数名称':'\\sin',
      '关系符号':'\\leq',
      '箭头符号':'\\rightarrow',
      '其他符号':'\\infty',
    };
    categories.forEach(category=>{
      const label=category==='矩阵与多行'?'Matrices and inner blocks':category;
      const tab=document.createElement('button');tab.type='button';tab.dataset.category=category;tab.title=t(label);tab.setAttribute('aria-label',t(label));tab.setAttribute('aria-pressed','false');
      const icon=document.createElement('span');icon.className='structure-preview category-preview';icon.setAttribute('aria-hidden','true');icon.textContent='\\('+categorySamples[category]+'\\)';tab.append(icon);nav.append(tab);
      const panel=document.createElement('div');panel.className='structure-group';panel.dataset.group=category;panel.setAttribute('role','group');panel.setAttribute('aria-label',t(label));
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
        if(entry.scope==='component'&&entry.rowEnvironment)card.title=mathLabel(entry)+' · '+t('Insert inside the current formula')+' · '+entry.command;
        if(entry.atom || entry.font || entry.category==='函数名称')card.classList.add('compact-card');
        if(entry.variantOf){card.title+=' · '+t('Right-click for variants');card.setAttribute('aria-haspopup','menu');card.setAttribute('aria-expanded','false');}
        const sample=entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>placeholderTex));
        const preview=document.createElement('span');preview.className='structure-preview';preview.setAttribute('aria-hidden','true');preview.textContent='\\(\\displaystyle '+sample+'\\)';
        const label=document.createElement('span');label.className='structure-label';label.textContent=mathLabel(entry);card.append(preview,label);
        if(entry.type==='chem-ce'||entry.type==='chem-pu'){
          card.classList.add('chemical-card');
          const command=document.createElement('code');command.textContent=entry.command+'{…}';card.append(command);
        }
        (rows.get(entry.category)??panel).append(card);
      });
      board.append(panel);ownedBoardNodes.push(panel);
    });
    const textButton=document.createElement('button');textButton.type='button';textButton.dataset.insert='text-normal';textButton.className='insert-text';textButton.textContent='Aa';textButton.title=t('Insert descriptive text')+' · \\textnormal{…}';textButton.setAttribute('aria-label',t('Insert descriptive text'));nav.append(textButton);
    colorControl=createMathColorControl({
      mount:elements.panel.querySelector<HTMLElement>('.board-heading')??nav,panel:elements.panel,
      canApply:target=>editing&&!flow?.readOnly&&model.canSetColor(target),
      canReset:target=>model.canResetColor(target),
      apply:(color,target)=>{if(model.setColor(color,target)){inputEdit=null;update();}},
      focus:()=>{if(editing)input.focus({preventScroll:true});}
    });
    colorControl.update();
    elements.structureCount.textContent=t('Right-click for variants · {count} categories',{count:categories.length});
    (elements.countLabels??[]).forEach(cell=>{cell.textContent=t('{count} presets; hover for exact syntax',{count:catalog.filter(entry=>entry.category===cell.dataset.countCategory).length});});
    showCategory(categories[0]);
  }
  const variantMenu = document.createElement('div');
  variantMenu.className='variant-menu';variantMenu.id=idFor('variantMenu');variantMenu.hidden=true;
  variantMenu.setAttribute('role','menu');overlayRoot.append(variantMenu);
  let variantTrigger:HTMLElement|null=null, variantNodeId:string|undefined, variantCellId:string|undefined;
  let variantLetter:{region:string;index:number}|null=null;
  interface SourceSession {owner:HTMLElement;editor:EditorModel;host:MathDocumentAdapter|undefined;context:MathSourceEditorContext}
  let sourceSession:SourceSession|undefined,sourceFocusAfterClose:SourceSession|undefined;
  const defaultSource=options.sourceEditor?undefined:createDefaultSourceEditor();
  function sourceOwnerIsCurrent(session:SourceSession):boolean {
    return !disposed&&!flow?.readOnly&&flow===session.host&&formula===session.owner&&model===session.editor&&session.owner.isConnected&&
      (!flow||flow.entries().some(entry=>entry.element===session.owner&&entry.model===session.editor));
  }
  function isSourceCurrent(session:SourceSession):boolean {return sourceSession===session&&sourceOwnerIsCurrent(session);}
  function resumeSourceOwner(session:SourceSession){
    if(!sourceOwnerIsCurrent(session))return;
    if(flow)flow.enter(session.owner,'end');else begin(model.root.id,model.root.items.length);
  }
  function closeSourceSession(session=sourceSession,restoreFocus=false){
    if(!session||sourceSession!==session)return;
    const resume=restoreFocus&&isSourceCurrent(session);
    sourceSession=undefined;
    // Browsers queue the dialog's close event. Resume there so late input/blur
    // events from its old hidden textarea cannot replay pre-conversion text.
    if(defaultSource?.dialog.open){sourceFocusAfterClose=resume?session:undefined;defaultSource.dialog.close();}
    else if(resume)resumeSourceOwner(session);
    options.sourceEditor?.close?.();
  }
  function applyFormulaSource(session:SourceSession,source:string):boolean {
    if(!isSourceCurrent(session))return false;
    // Commit any pending IME input before replacing the same formula. A hosted
    // editor may stay open while the user moves between source and visual math.
    finish();
    if(!isSourceCurrent(session))return false;
    if(flow?.replaceFormulaSource)flow.replaceFormulaSource(session.owner,source);
    else{const converted=convertMath(source).snapshot();model.record();model.restore(converted);}
    inputEdit=null;update();
    return true;
  }
  function openSource(owner=formula){
    if(disposed||flow?.readOnly||!owner.isConnected)return;
    if(flow&&!flow.entries().some(entry=>entry.element===owner))return;
    sourceFocusAfterClose=undefined;
    closeSourceSession();
    if(owner!==formula)flow?.enter(owner,'end');
    if(owner!==formula)return;
    finish();closeVariantMenu();flow?.syncMath();
    const context:MathSourceEditorContext={
      source:flow?.getFormulaSource?.(owner)??model.exportLatex(),
      apply:source=>applyFormulaSource(session,source),
      cancel:()=>closeSourceSession(session,true),
      isCurrent:()=>isSourceCurrent(session),
    };
    const session:SourceSession={owner,editor:model,host:flow,context};sourceSession=session;
    if(options.sourceEditor)options.sourceEditor.open(context);
    else if(defaultSource){defaultSource.input.value=context.source;defaultSource.dialog.showModal();defaultSource.input.focus();defaultSource.input.setSelectionRange(0,0);}
  }
  function createDefaultSourceEditor(){
    const dialog=document.createElement('dialog');dialog.id=idFor('formulaSourceDialog');dialog.className='document-unsaved-dialog formula-source-dialog';
    const title=document.createElement('h2');title.id=idFor('formulaSourceTitle');title.textContent=t('Edit LaTeX source');dialog.setAttribute('aria-labelledby',title.id);
    const help=document.createElement('p');help.textContent=t('Edit the existing source and convert it back to editable math. Unsupported fragments keep their source.');
    const source=document.createElement('textarea');source.id=idFor('formulaSourceInput');source.setAttribute('aria-label',t('LaTeX source'));source.spellcheck=false;
    const actions=document.createElement('div');actions.className='document-unsaved-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent=t('Cancel');
    const apply=document.createElement('button');apply.type='button';apply.dataset.choice='save';apply.textContent=t('Apply and convert');
    actions.append(cancel,apply);dialog.append(title,help,source,actions);overlayRoot.append(dialog);
    listen(cancel,'click',()=>closeSourceSession(sourceSession,true));
    listen(dialog,'close',()=>{
      if(dialog.open)return;
      const resume=sourceFocusAfterClose;sourceFocusAfterClose=undefined;
      if(resume&&!sourceSession)resumeSourceOwner(resume);else closeSourceSession(sourceSession,true);
    });
    listen(apply,'click',()=>{const session=sourceSession;if(!session)return;if(session.context.apply(source.value))closeSourceSession(session,true);else closeSourceSession(session);});
    const button=document.createElement('button');button.id=idFor('formulaSourceButton');button.className='formula-source-button';button.type='button';button.textContent='LaTeX';button.title=t('Edit LaTeX source');button.setAttribute('aria-label',t('Edit LaTeX source'));
    (elements.layout.closest('.document-actions')??elements.panel).append(button);
    listen(button,'pointerdown',event=>event.preventDefault());listen(button,'click',()=>openSource());
    return {dialog,input:source,button};
  }
  function appendSourceMenu(owner:HTMLElement,x:number,y:number){
    if(variantMenu.hidden){variantMenu.replaceChildren();variantMenu.setAttribute('aria-label',t('Formula'));}
    const option=document.createElement('button');option.type='button';option.dataset.editFormulaSource=owner.dataset.mathId??'';option.textContent=options.sourceEditor?.label??t('Edit LaTeX source');option.setAttribute('role','menuitem');variantMenu.append(option);
    variantMenu.hidden=false;const rect=variantMenu.getBoundingClientRect();variantMenu.style.left=Math.max(8,Math.min(x,window.innerWidth-rect.width-8))+'px';variantMenu.style.top=Math.max(8,Math.min(y,window.innerHeight-rect.height-8))+'px';
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
    const entries=palette.filter(entry=>entry.scope!=='formula' && !entry.hidden && !entry.legacy && entry.variantOf===(node?definition?.variantOf:button.dataset.insert) && entry.variantOf && !(node && entry.type==='matrix3'));
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
      const command=document.createElement('code');command.textContent=(entry.equivalentTex??[entry.exportTex??sample.replaceAll(placeholderTex,'…')]).join(' = ');
      option.setAttribute('aria-label',command.textContent);option.title=command.textContent;option.classList.add('rendered-variant');
      option.append(glyph,command);
      // Render into this option only: a closed/reopened menu must not receive stale results.
      glyph.textContent='\\('+sample+'\\)';
      void MathJax.typesetPromise([glyph]).then(()=>{
        if(disposed||!option.isConnected)return;
        if(!variantMenu.hidden){
          const rect=variantMenu.getBoundingClientRect();
          variantMenu.style.left=Math.max(8,Math.min(x,window.innerWidth-rect.width-8))+'px';
          variantMenu.style.top=Math.max(8,Math.min(y,window.innerHeight-rect.height-8))+'px';
        }
      }).catch(()=>{if(!disposed){glyph.textContent='—';glyph.title=t('预览暂不可用');}});
      if(entry.font){const coverage=fontPresentation(entry.command)?.coverage;if(coverage)option.title+=' · '+coverage;}
      if(node){
        option.setAttribute('role','menuitemradio');option.setAttribute('aria-checked',String(entry.type===node.type || (!!entry.glyphKey&&entry.glyphKey===definition?.glyphKey) || (!!entry.tex&&entry.tex===definition?.tex) || (node.type==='matrix3' && entry.type==='matrix')));
        option.disabled=!!node.id&&!model.canSwitchVariant(node.id,entry.type);
        if(option.disabled){option.title=t('This variant cannot preserve the current contents.');}
      }
      variantMenu.append(option);
    }
    button.setAttribute('aria-expanded','true');variantMenu.hidden=false;
    const rect=variantMenu.getBoundingClientRect();
    variantMenu.style.left=Math.max(8,Math.min(x,window.innerWidth-rect.width-8))+'px';
    variantMenu.style.top=Math.max(8,Math.min(y,window.innerHeight-rect.height-8))+'px';
  }
  listen(elements.toolbar,'contextmenu',event=>{
    const button=eventElement(event).closest<HTMLElement>('button[data-insert]');if(!button?.hasAttribute('aria-haspopup'))return;
    event.preventDefault();openVariantMenu(button,event.clientX,event.clientY);
  });
  listen(elements.toolbar,'keydown',event=>{
    const button=eventElement(event).closest<HTMLElement>('button[aria-haspopup]');
    if(button && (event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){
      event.preventDefault();const rect=button.getBoundingClientRect();openVariantMenu(button,rect.left,rect.bottom);
    }
  });
  listen(variantMenu,'pointerdown',event=>event.preventDefault());
  function appendNumberingMenu(owner:HTMLElement,x:number,y:number){
    if(!flow?.isDisplay(owner))return;
    const entry=flow.entries().find(entry=>entry.element===owner),layout=entry?.model.formulaLayout()?.formula;
    if(entry&&!layout&&intrinsicMathLayout(entry.model))return;
    if(variantMenu.hidden){MathJax.typesetClear([variantMenu]);variantMenu.replaceChildren();variantMenu.setAttribute('aria-label',t('Display'));}
    else {const divider=document.createElement('div');divider.setAttribute('role','separator');variantMenu.append(divider);}
    if(layout){
      const group=(label:string,field:'numbering'|'alignment',choices:readonly (readonly [string,string])[])=>{
        const heading=document.createElement('div');heading.className='menu-heading';heading.textContent=t(label);variantMenu.append(heading);
        for(const [value,label] of choices){
          const target=formulaLayouts.find(item=>item.kind===layout.kind&&item[field]===value&&
            (field==='numbering'?item.alignment===layout.alignment:item.numbering===layout.numbering));
          if(!target)continue;
          const option=document.createElement('button');option.type='button';option.dataset.formulaVariant=target.type;
          option.dataset.formulaId=owner.dataset.mathId;option.textContent=t(label);option.setAttribute('role','menuitemradio');
          option.setAttribute('aria-checked',String(layout[field]===value));variantMenu.append(option);
        }
      };
      group('Numbering','numbering',[['single','One number'],['rows','Number each row'],['subrows','Number subrows'],['none','Unnumbered']]);
      if(layout.kind==='align')group('Alignment','alignment',[['standard','Standard spacing'],['compact','Compact spacing'],['spread','Full width']]);
    }else for(const [value,label] of [['true','编号'],['false','不编号']]){
      const option=document.createElement('button');option.type='button';option.dataset.numbered=value;
      option.dataset.formulaId=owner.dataset.mathId;option.textContent=t(label);option.setAttribute('role','menuitemradio');
      option.setAttribute('aria-checked',String(flow.isNumbered(owner)===(value==='true')));variantMenu.append(option);
    }
    variantMenu.hidden=false;const rect=variantMenu.getBoundingClientRect();
    variantMenu.style.left=Math.max(8,Math.min(x,window.innerWidth-rect.width-8))+'px';
    variantMenu.style.top=Math.max(8,Math.min(y,window.innerHeight-rect.height-8))+'px';
  }
  listen(variantMenu,'click',event=>{
    if(flow?.readOnly){closeVariantMenu();return;}
    const source=eventElement(event).closest<HTMLButtonElement>('[data-edit-formula-source]');
    if(source){const owner=flow?.entries().find(e=>e.element.dataset.mathId===source.dataset.editFormulaSource)?.element??formula;openSource(owner);return;}
    const numbering=eventElement(event).closest<HTMLButtonElement>('[data-numbered]');
    if(numbering){const owner=flow?.entries().find(e=>e.element.dataset.mathId===numbering.dataset.formulaId)?.element;
      if(owner)flow?.setNumbered(owner,numbering.dataset.numbered==='true');closeVariantMenu();return;}
    const formulaVariant=eventElement(event).closest<HTMLButtonElement>('[data-formula-variant]');
    if(formulaVariant){
      const entry=flow?.entries().find(entry=>entry.element.dataset.mathId===formulaVariant.dataset.formulaId);
      const node=entry?.model.root.items[0];
      if(entry&&node&&typeof node!=='string'){
        entry.model.switchVariant(node.id,formulaVariant.dataset.formulaVariant!);
        flow?.syncMath();closeVariantMenu();inputEdit=null;update();
        if(editing)input.focus({preventScroll:true});
      }
      return;
    }
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
  listen(document,'pointerdown',event=>{
    if(!variantMenu.hidden&&!variantMenu.contains(eventElement(event)))closeVariantMenu();
  },true);
  listen(document,'keydown',event=>{
    if(variantMenu.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeVariantMenu(true);}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();
      const options=[...variantMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],i=options.findIndex(option=>option===document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:(i+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;
      options[next].focus({preventScroll:true});
    }else if(event.key==='Tab')closeVariantMenu();
  },true);
  listen(window,'resize',()=>closeVariantMenu());
  listen(document,'scroll',event=>{if(!variantMenu.contains(eventElement(event)))closeVariantMenu();},true);
  buildBoard();
  let boardTypeset:Promise<void>|undefined;
  function decorateEditing(){
    for(const element of decorated)element.classList.remove('math-active-region','math-selected');
    decorated=[];
    if(!editing||disposed){caret.hidden=true;return;}
    const region=formula.querySelector<HTMLElement>('.region-'+model.cursor.region);
    if(region){region.classList.add('math-active-region');decorated.push(region);}
    const [start,end]=model.range;
    for(let index=start;index<end;index++){
      const item=formula.querySelector<HTMLElement>(`.item-${model.cursor.region}-${index}`);
      if(item){item.classList.add('math-selected');decorated.push(item);}
    }
    positionCaret();
  }
  function positionCaret(){
    if(!editing||disposed||!formula.isConnected){caret.hidden=true;return;}
    const region=formula.querySelector<HTMLElement>('.region-'+model.cursor.region);
    if(!region){caret.hidden=true;return;}
    const next=formula.querySelector<HTMLElement>(`.item-${model.cursor.region}-${model.cursor.offset}`);
    const previous=model.cursor.offset?formula.querySelector<HTMLElement>(`.item-${model.cursor.region}-${model.cursor.offset-1}`):null;
    const empty=region.querySelector<HTMLElement>('.math-placeholder');
    const reference=next??previous??empty??region,rect=reference.getBoundingClientRect();
    const number=(value:string)=>Number.parseFloat(value)||0;
    const scaleOf=(element:HTMLElement)=>{
      const style=window.getComputedStyle(element),width=number(style.width)+(style.boxSizing==='border-box'?0:number(style.paddingLeft)+number(style.paddingRight)+number(style.borderLeftWidth)+number(style.borderRightWidth));
      const rendered=element.getBoundingClientRect().width;
      return width&&rendered?rendered/width:1;
    };
    const referenceStyle=window.getComputedStyle(reference),referenceScale=scaleOf(reference);
    const x=next?rect.left+number(referenceStyle.paddingLeft)*referenceScale:previous?rect.right-number(referenceStyle.paddingRight)*referenceScale:rect.left;
    // Measure the baseline in the already typeset DOM. This probe has no TeX
    // or MathML representation and is removed before painting the caret.
    const probe=document.createElement('span');probe.setAttribute('aria-hidden','true');
    probe.style.cssText='display:inline-block;width:0;height:0;font-size:0;padding:0;margin:0;border:0;line-height:0;vertical-align:baseline;pointer-events:none;';
    region.append(probe);
    const baseline=probe.getBoundingClientRect().top,fontSize=window.getComputedStyle(region).fontSize;
    probe.remove();
    const box=formula.getBoundingClientRect(),scale=scaleOf(formula);
    caret.style.left=((x-box.left)/scale+formula.scrollLeft-formula.clientLeft)+'px';
    caret.style.top=((baseline-box.top)/scale+formula.scrollTop-formula.clientTop)+'px';
    caret.style.fontSize=fontSize;caret.hidden=false;
    if(caret.parentElement!==formula)formula.append(caret);
  }
  function positionInput() {
    if (disposed||!editing) return;
    positionCaret();if(caret.hidden)return;
    const rect = caret.getBoundingClientRect(), box = preview.getBoundingClientRect();
    input.style.left = (rect.left - box.left - preview.clientLeft + preview.scrollLeft) + 'px';
    input.style.top = (rect.top - box.top - preview.clientTop + preview.scrollTop) + 'px';
    positionCommands();
  }
  function render():Promise<void> {
    if (disposed||!window.ready) return Promise.resolve();
    // Exports share the in-flight repaint rather than snapshotting stale math.
    return rendering??=renderCurrent().finally(()=>{rendering=undefined;});
  }
  async function renderCurrent() {
    let stage:HTMLDivElement|undefined;
    try {
      lastRenderFailure=undefined;
      // ES modules can finish loading after MathJax's initial page scan.
      boardTypeset??=MathJax.typesetPromise([...elements.toolbar.querySelectorAll<HTMLElement>('.structure-preview')].filter(el=>!el.querySelector('mjx-container')));
      await boardTypeset;if(disposed)return;
      // Prose-only changes do not need a math staging element or its layout read.
      // The input board still receives its one initial typeset above.
      if(flow&&!flow.entries().length){error.textContent='';fontHint.textContent='';return;}
      let rendered;
      do {
        rendered = revision;
        await validateChemistry();if(disposed)return;
        if(stage)MathJax.typesetClear([stage]);
        const edge = (side:string) => `\\class{math-boundary boundary-${side}}{\\vphantom{Xg}\\kern0.15em}`;
        const surface=elements.content.closest<HTMLElement>('.document-zoom-surface');
        const font=surface?.dataset.mathFont==='mathjax-stix2'?'mathjax-stix2':'mathjax-newcm';
        await selectMathFont(font,document);
        const typographyKey=(surface?.dataset.typeSizes??'')+font;
        let equationNumber=0;
        for(const entry of flow?.entries()||[{element:formula,model}]){
          const intrinsic=intrinsicMathLayout(entry.model),display=flow?.isDisplay(entry.element)||!!intrinsic;
          const numbered=intrinsic?intrinsic.numbered:display&&flow?.isNumbered(entry.element),environment=numbered?'equation':'equation*';
          const firstNumber=equationNumber;
          if(numbered)equationNumber+=intrinsic?.count??1;
          const label=entry.element.dataset.texLabel;
          const content=regionTex(entry.model.root,entry.model,editing&&entry.model===model);
          // Display boundaries locate the prose caret next to a centered equation.
          // Inline formulas use their existing box for hit testing.
          const expression=display&&!intrinsic?edge('start')+content+edge('end'):content;
          const source=(intrinsic?'\\[':display?`\\begin{${environment}}`:'\\(')+expression+(intrinsic?'\\]':display?`\\end{${environment}}`:'\\)');
          const width=elements.content.clientWidth;
          const cacheKey=typographyKey+(label||'')+(display?`${equationNumber}:${width}:`:'')+source;
          if(renderedSources.get(entry.element)===cacheKey)continue;
          if(!stage){
            stage=document.createElement('div');activeStage=stage;stage.id=idFor('renderStage');stage.className='math-render-stage';stage.setAttribute('aria-hidden','true');
            document.body.append(stage);
          }
          MathJax.typesetClear([stage]);const entryStyle=window.getComputedStyle(entry.element);
          stage.style.fontSize=entryStyle.fontSize;stage.style.fontFamily=entryStyle.fontFamily;
          stage.style.width=display?width+'px':'auto';stage.textContent=source;
          // Let MathJax generate the tag, seeded by this equation's document order.
          // Cursor redraws must not increment numbering; moved equations invalidate the cache.
          if(display)MathJax.texReset(firstNumber);
          await MathJax.typesetPromise([stage]);if(disposed)return;
          if(rendered!==revision)break;
          const failed=stage.querySelector('mjx-merror');
          if(failed)throw new Error(failed.textContent || t('MathJax 无法排版'));
          MathJax.typesetClear([entry.element]);entry.element.replaceChildren(...stage.childNodes);renderedSources.set(entry.element,cacheKey);
        }
      } while (rendered !== revision);
      error.textContent = [...chemicalStates].some(([node,state])=>isChemical(node)&&!state.valid)?t('化学语法尚未完整，已保留源码；点击该区域可继续编辑。'):'';
      for(const {element} of flow?.entries()||[{element:formula}]){
        element.querySelectorAll<HTMLElement>('.math-source-region').forEach(region=>{region.title=t('Click to edit this fragment’s LaTeX source');});
      }
      annotateFontWarnings();decorateEditing();positionInput();
    } catch (err) { if(disposed)return;lastRenderFailure=err;error.textContent = t('公式排版失败：') + String(err); }
    finally { if(stage){try{MathJax.typesetClear([stage]);}catch{/* Removing owned DOM must not depend on a healthy renderer. */}finally{stage.remove();if(activeStage===stage)activeStage=undefined;}} }
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
    if(formula.contains(target)&&!formula.classList.contains('display-formula')){
      const box=formula.getBoundingClientRect();
      const edgeWidth=Math.min(2,box.width/4);
      if(edgeWidth>0&&x>=box.left&&x<=box.left+edgeWidth)return {id:model.root.id,offset:0};
      if(edgeWidth>0&&x<=box.right&&x>=box.right-edgeWidth)return {id:model.root.id,offset:model.root.items.length};
    }
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
  listen(preview,'pointerdown', event => {
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
  listen(preview,'pointermove', event => {
    if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    const target = document.elementFromPoint(event.clientX, event.clientY); if (!target) return;
    const point = hit(target, event.clientX);
    if (point?.id === drag.id) { model.setCursor(point.id, point.offset, drag.anchor); update(); }
  });
  listen(preview,'pointerup', () => { drag = null; });
  listen(preview,'pointercancel', () => { drag = null; });
  listen(preview,'click', event => { if(eventElement(event).closest('.inline-formula')){event.preventDefault();event.stopPropagation();} });
  listen(preview,'contextmenu',event=>{
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
  listen(preview,'keydown', event => {
    const target=eventElement(event).closest<HTMLElement>('.inline-formula');if(!target)return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flow?.enter(target,'end'); }
  });
  listen(input,'keydown', event => {
    if(flow?.readOnly){event.preventDefault();return;}
    if (event.isComposing || event.keyCode === 229) return;
    if(!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['Tab','Enter'].includes(event.key)&&completeColorInput(true)){
      event.preventDefault();inputEdit=null;update();return;
    }
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
  listen(input,'beforeinput', event => {
    if(flow?.readOnly){event.preventDefault();return;}
    if (!editing || composing) return;
    let start = Array.from(input.value.slice(0, input.selectionStart)).length;
    let end = Array.from(input.value.slice(0, input.selectionEnd)).length;
    if (start === end && event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
    if (start === end && event.inputType === 'deleteContentForward') end = Math.min(model.current.items.length, end + 1);
    inputEdit = {region: model.cursor.region, start, end};
  });
  function acceptInput() {
    if(flow?.readOnly){inputEdit=null;syncInput();return;}
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
        completeColorInput();
        update(); return;
      }
    }
    let start = 0, suffix = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    model.replaceInput(start, before.length - suffix, after.slice(start, after.length - suffix).join(''));
    completeColorInput();
    update();
  }
  function completeColorInput(explicit=false):boolean {
    if(!editing||composing||flow?.readOnly)return false;
    const parent=model.parents.get(model.cursor.region);
    if(parent?.node.type!=='source-tex'||model.range[0]!==model.range[1]||model.cursor.offset!==model.current.items.length)return false;
    const converted=convertTypedColorCommand(model.current.items.join(''),explicit);if(!converted)return false;
    if(explicit)model.record();
    return model.commitSourceInput(converted.model.root.items,converted.declaration);
  }
  /** Preserve an IME draft before permission/connection loss without publishing it. */
  function pendingMathSnapshot(){
    if(!editing||input.value===model.projection()||!formula.dataset.mathId)return undefined;
    const draft=new EditorModel();draft.restore(model.snapshot());
    const before=Array.from(draft.projection()),after=Array.from(input.value),edit=inputEdit;
    if(edit?.region===draft.cursor.region){
      const length=after.length-before.length+edit.end-edit.start;
      if(length>=0){draft.replaceInput(edit.start,edit.end,after.slice(edit.start,edit.start+length).join(''));return {formulaId:formula.dataset.mathId,snapshot:draft.snapshot()};}
    }
    let start=0,suffix=0;
    while(start<before.length&&start<after.length&&before[start]===after[start])start++;
    while(suffix<before.length-start&&suffix<after.length-start&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
    draft.replaceInput(start,before.length-suffix,after.slice(start,after.length-suffix).join(''));
    return {formulaId:formula.dataset.mathId,snapshot:draft.snapshot()};
  }
  listen(input,'input', acceptInput);
  listen(input,'compositionstart', () => {
    if(flow?.readOnly)return;
    if (!editing) return;
    inputEdit = {region: model.cursor.region, start: model.range[0], end: model.range[1]};
    composing = true;
    syncCommands();
  });
  listen(input,'compositionend', () => { if (!composing) return; composing = false; acceptInput();flow?.syncMath(); });
  listen(document,'selectionchange', () => {
    if (!editing || composing || document.activeElement !== input || input.value !== model.projection()) return;
    const start = Array.from(input.value.slice(0, input.selectionStart)).length;
    const end = Array.from(input.value.slice(0, input.selectionEnd)).length;
    const offset = input.selectionDirection === 'backward' ? start : end, anchor = input.selectionDirection === 'backward' ? end : start;
    if (offset !== model.cursor.offset || anchor !== model.cursor.anchor) { model.setCursor(model.cursor.region, offset, anchor); update(false); }
  });
  listen(input,'blur', event => { if(event.relatedTarget instanceof Node && elements.panel.contains(event.relatedTarget))return; finish(); });
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
    // A cut may delete only after at least its readable representation was written.
    if(!(options.clipboard??mathClipboard).write(event.clipboardData,model.selectionSnapshot(),model.selectionLatex()))return;
    if(cut){model.replace(start,end,'');inputEdit=null;update();}
  }
  listen(input,'copy',event=>copyMath(event));
  listen(input,'cut',event=>copyMath(event,true));
  listen(input,'paste',event=>{
    if(!editing||!event.clipboardData||flow?.readOnly)return;
    if(composing){composing=false;acceptInput();}
    clipboardSelection();const data=event.clipboardData;
    try {
    const native=(options.clipboard??mathClipboard).read(data);
    const plain=data.getData('text/plain');
    let imported:EditorModel|undefined,sourceFallback:string|undefined;
    if(native?.snapshot){
      imported=new EditorModel();imported.restore(native.snapshot);
    }else if(native?.source!==undefined){
      const normalized=normalizeMathSource(native.source);sourceFallback=normalized?.source??native.source;
      imported=(normalized?convertMath(normalized.source):null)??undefined;
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
      const incoming=sourceFallback??plain;if(!incoming)return;
      const normalized=normalizeMathSource(incoming),source=normalized?.source??incoming;
      const parsed=normalized?convertMath(source):null;
      event.preventDefault();event.stopPropagation();
      if(parsed)model.replaceFragment(parsed.root.items);else model.insertSourceTex(source);
    }
    inputEdit=null;update();
    }catch(cause){
      event.preventDefault();event.stopPropagation();
      const message=cause instanceof Error?cause.message:String(cause);
      error.textContent=message==='A whole formula can only replace the complete formula.'?
        t('A complete display equation must be inserted in the document, not inside another formula.'):
        t('Unable to paste this formula.')+' '+message;
    }
  });
  listen(window,'resize',()=>{positionInput();update();});
  const resizeObserver=new window.ResizeObserver(positionInput);resizeObserver.observe(preview);
  const notifyLoadFailure=()=>{if(!disposed)error.textContent=t('MathJax 加载失败，请检查网络连接。');};
  listen(window,'mathjax-ready',()=>render());
  const startupTimer=window.setTimeout(() => { if (!disposed&&!window.ready) error.textContent = t('MathJax 尚未就绪，请检查网络连接。'); }, 10000);
  const hooks:MathEditorHooks={
    activate:(element,editor,edge)=>{
      if(disposed)return;
      if(editor!==model||element!==formula){sourceFocusAfterClose=undefined;closeSourceSession();finish();formula.removeAttribute('id');formula=element;formula.id=formulaId;model=editor;}
      begin(model.root.id,edge==='start'?0:model.root.items.length);
    },
    leave:()=>{if(!disposed)finish();},change:()=>update(),isComposing:()=>!disposed&&composing,pendingMathSnapshot:()=>disposed?undefined:pendingMathSnapshot(),
    renderForExport:async()=>{
      if(disposed)throw Error('The formula editor is no longer mounted.');
      flow?.syncMath();
      await Promise.resolve();
      if(!flow?.entries().length)return;
      if(!window.ready)await new Promise<void>((resolve,reject)=>{
        const ready=()=>{window.clearTimeout(timeout);events.signal.removeEventListener('abort',aborted);resolve();};
        const aborted=()=>{window.clearTimeout(timeout);reject(Error('The formula editor is no longer mounted.'));};
        const timeout=window.setTimeout(()=>{window.removeEventListener('mathjax-ready',ready);events.signal.removeEventListener('abort',aborted);reject(Error(t('MathJax is not ready. Please try exporting again after the formulas load.')));},10000);
        listen(window,'mathjax-ready',ready,{once:true});
        events.signal.addEventListener('abort',aborted,{once:true});
      });
      await render();
      if(lastRenderFailure!==undefined)throw lastRenderFailure;
    }
  };
  function connect(adapter:MathDocumentAdapter):void {
    if(disposed)throw Error('The formula editor is no longer mounted.');
    if(flow&&flow!==adapter)throw Error('The formula editor is already connected.');
    flow=adapter;
    const initial=flow.entries()[0];if(initial){formula=initial.element;formula.id=formulaId;model=initial.model;}
    update();
  }
  listen(elements.layout,'change',event=>{
    if(flow?.readOnly)return;
    flow?.setDisplay(formula,(event.target as HTMLSelectElement).value==='display');
    input.focus({preventScroll:true});
  });
  function dispose():void {
    if(disposed)return;
    disposed=true;editing=false;composing=false;inputEdit=null;revision++;
    events.abort();resizeObserver.disconnect();window.clearTimeout(startupTimer);
    colorControl?.dispose();
    caret.remove();for(const element of decorated)element.classList.remove('math-active-region','math-selected');decorated=[];
    if(frame!==undefined)window.cancelAnimationFrame(frame);
    if(activeStage){try{MathJax.typesetClear([activeStage]);}catch{/* A failed renderer cannot prevent component disposal. */}finally{activeStage.remove();activeStage=undefined;}}
    closeSourceSession();defaultSource?.dialog.remove();defaultSource?.button.remove();variantMenu.remove();commandMenu.remove();fontHint.remove();
    for(const node of ownedBoardNodes)node.remove();
    input.hidden=true;input.removeAttribute('aria-controls');input.removeAttribute('aria-autocomplete');input.removeAttribute('aria-expanded');input.removeAttribute('aria-activedescendant');
    chemicalStates.clear();flow=undefined;
  }
  return {initialModel,hooks,connect,openSource,render,notifyLoadFailure,dispose};
}
