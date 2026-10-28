import {
  BaseFootnoteDefinitionPlugin,
  BaseFootnoteReferencePlugin,
} from '@platejs/footnote';
import { MarkdownPlugin, remarkMdx, remarkMention, serializeMd, type SerializeMdOptions } from '@platejs/markdown';
import {markdownDisplayBlocks} from '@/plate-document';
import {referenceTex,type ReferenceNode} from '@/references';
import { KEYS,NodeApi,type Descendant } from 'platejs';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';


export const MarkdownKit = [
  BaseFootnoteReferencePlugin,
  BaseFootnoteDefinitionPlugin,
  MarkdownPlugin.configure({
    options: {
      rules: {
        document_export_html:{serialize:node=>({type:'html',value:String(node.source??'')})},
        tex_label:{serialize:node=>({type:'text',value:'\\label{'+node.texLabel+'}'})},
        tex_reference:{serialize:node=>({type:'text',value:referenceTex(node as ReferenceNode)})},
        bibliography_entry:{serialize:node=>({type:'paragraph',children:[{type:'text',value:'\\bibitem{'+node.citeKey+'} '+NodeApi.string(node)}]})},
        equation: {
          deserialize: (node) => ({type:'equation',texExpression:node.value,numbered:node.meta==='numbered',children:[{text:''}]}),
          serialize: (node) => ({type:'math',value:node.texExpression+(node.texLabel&&node.numbered!==false?'\\label{'+node.texLabel+'}':''),meta:node.numbered!==false?'numbered':undefined}),
        },
      },
      plainMarks: [KEYS.suggestion, KEYS.comment],
      remarkPlugins: [
        remarkMath,

        remarkGfm,
        remarkEmoji as any,
        remarkMdx,
        remarkMention,
      ],
    },
  }).extendApi(({editor})=>({
    serialize:(options?:Omit<SerializeMdOptions,'editor'>)=>{
      const render=(value:Descendant[]):string=>serializeMd(editor,{
        ...options,value:markdownDisplayBlocks(value,render),
      });
      return render(options?.value??editor.children);
    },
  })).extend({
    // Markdown is an explicit export API. Ordinary body paste is literal text
    // or rich HTML, so backslashes and low-frequency markup never reinterpret
    // what the user copied.
    parser:{query:()=>false},
  }),
];
