/** Test-only assembly for fixtures written against the former host factory. */
function mathElements(window,root=window.document){
  const get=id=>root.querySelector('[id="'+id+'"]');
  return {formula:get('formula'),preview:get('preview'),get content(){return get('textFlow');},
    input:get('mathInput'),error:get('error'),panel:get('mathPanel'),toolbar:get('insertToolbar'),
    layout:get('formulaLayout'),pendingFontHint:get('pendingFontHint'),structureCount:get('structureCount'),
    overlayRoot:window.document.body,countLabels:[...root.querySelectorAll('[data-count-category]')]};
}
function mountMathEditor(window,api,createHost){
  const elements=mathElements(window),editor=api.createMathEditor({elements,clipboard:api.documentMathClipboard});
  const host=createHost(elements.content,editor.initialModel,editor.hooks);
  host.syncMath??=()=>{};
  editor.connect(host);
  window.mathjaxLoadFailed=editor.notifyLoadFailure;
  return editor;
}
module.exports={mathElements,mountMathEditor};
