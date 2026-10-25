import type {TEquationElement} from 'platejs';
import {SlateElement,type SlateElementProps} from 'platejs/static';

/** Static HTML carries TeX and the semantic snapshot; the export loads MathJax. */
export function EquationElementStatic(props:SlateElementProps<TEquationElement>){
 const node=props.element;
 const source=String(node.texExpression||'');
 return <SlateElement {...props} as="div" attributes={{...props.attributes,'data-slate-tex-expression':source,'data-math-snapshot':typeof node.snapshot==='string'?node.snapshot:undefined,'data-numbered':String(node.numbered!==false)}}>
  {node.numbered===false?'\\['+source+'\\]':'\\begin{equation}'+source+'\\end{equation}'}{props.children}
 </SlateElement>;
}
export function InlineEquationElementStatic(props:SlateElementProps<TEquationElement>){
 const node=props.element,source=String(node.texExpression||'');
 return <SlateElement {...props} as="span" attributes={{...props.attributes,'data-slate-tex-expression':source,'data-math-snapshot':typeof node.snapshot==='string'?node.snapshot:undefined}}>{'\\('+source+'\\)'}{props.children}</SlateElement>;
}

export function EquationElementDocx(
  props: SlateElementProps<TEquationElement>
) {
  const { element } = props;
  const texExpression =
    typeof element.texExpression === 'string' ||
    typeof element.texExpression === 'number' ||
    typeof element.texExpression === 'boolean'
      ? String(element.texExpression)
      : '';

  if (!texExpression) {
    return (
      <SlateElement {...props}>
        <p style={{ color: '#888', fontStyle: 'italic' }}>[Empty equation]</p>
        {props.children}
      </SlateElement>
    );
  }

  return (
    <SlateElement {...props}>
      <p
        style={{
          fontFamily: 'Cambria Math, Consolas, monospace',
          fontSize: '12pt',
          margin: '8pt 0',
          textAlign: 'center',
        }}
      >
        {texExpression}
      </p>
      {props.children}
    </SlateElement>
  );
}

/**
 * DOCX-compatible inline equation component.
 * Displays LaTeX source code inline.
 */
export function InlineEquationElementDocx(
  props: SlateElementProps<TEquationElement>
) {
  const { element } = props;
  const texExpression =
    typeof element.texExpression === 'string' ||
    typeof element.texExpression === 'number' ||
    typeof element.texExpression === 'boolean'
      ? String(element.texExpression)
      : '';

  if (!texExpression) {
    return (
      <SlateElement {...props} as="span">
        <span style={{ color: '#888', fontStyle: 'italic' }}>[equation]</span>
        {props.children}
      </SlateElement>
    );
  }

  return (
    <SlateElement {...props} as="span">
      <span
        style={{
          fontFamily: 'Cambria Math, Consolas, monospace',
        }}
      >
        {texExpression}
      </span>
      {props.children}
    </SlateElement>
  );
}
