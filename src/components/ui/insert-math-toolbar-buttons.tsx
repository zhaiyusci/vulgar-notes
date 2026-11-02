import {useContext} from 'react';
import {RadicalIcon, SquareSigmaIcon} from 'lucide-react';
import {HostContext} from '../../plate-math-element';
import {ToolbarButton} from './toolbar';
import {formulaEntries} from '../../formula-layouts';
import {t} from '../../i18n';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from './dropdown-menu';

/** The document adapter owns insertion; the math editor owns the formula content. */
export function InsertMathToolbarButtons(){
  const host=useContext(HostContext);
  return <>
    <ToolbarButton tooltip="插入行内公式" onPointerDown={e=>e.preventDefault()} onClick={()=>host?.insertFormula()}><RadicalIcon /></ToolbarButton>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><ToolbarButton tooltip="插入行间公式" isDropdown><SquareSigmaIcon /></ToolbarButton></DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={event=>event.preventDefault()}>
        {formulaEntries.map(entry=><DropdownMenuItem key={entry.kind} onSelect={()=>host?.insertFormulaEntry(entry.defaultType)}>{t(entry.label)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}
