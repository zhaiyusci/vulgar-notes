import {readNativeClipboard} from './native-clipboard';
import {mathClipboard,type MathClipboardAdapter} from './math-clipboard';

/** Application bridge: only the document adapter understands Plate's fragment schema. */
export const documentMathClipboard:MathClipboardAdapter={
  read(data){
    // Validate the complete native document, including referenced data and nested snapshots.
    const native=readNativeClipboard(data);
    if(native?.kind==='document'){
      const formulas:{snapshot?:string;texExpression?:string}[]=[],other:string[]=[];
      const walk=(nodes:readonly any[])=>{for(const node of nodes){
        if(node.type==='inline_equation'||node.type==='equation')formulas.push(node);
        else if(typeof node.text==='string'){if(node.text.trim())other.push(node.text);}
        else if(node.type==='p'&&Array.isArray(node.children))walk(node.children);
        else other.push('block');
      }};
      walk(native.value);
      if(formulas.length===1&&!other.length){
        const formula=formulas[0];
        if(formula.snapshot)return {snapshot:formula.snapshot};
        if(formula.texExpression!==undefined)return {source:formula.texExpression};
      }
    }
    return mathClipboard.read(data);
  },
  write:mathClipboard.write,
};
