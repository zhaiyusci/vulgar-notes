import {useContext} from 'react';
import {RadicalIcon, SquareSigmaIcon} from 'lucide-react';
import {HostContext} from '../../plate-math-element';
import {ToolbarButton} from './toolbar';

/** The document adapter owns insertion; the math editor owns the formula content. */
export function InsertMathToolbarButtons(){
  const host=useContext(HostContext);
  return <>
    <ToolbarButton tooltip="插入行内公式" onPointerDown={e=>e.preventDefault()} onClick={()=>host?.insertFormula()}><RadicalIcon /></ToolbarButton>
    <ToolbarButton tooltip="插入行间公式" onPointerDown={e=>e.preventDefault()} onClick={()=>host?.insertFormula(true)}><SquareSigmaIcon /></ToolbarButton>
  </>;
}
