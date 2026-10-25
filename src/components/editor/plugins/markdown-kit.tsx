import {
  BaseFootnoteDefinitionPlugin,
  BaseFootnoteReferencePlugin,
} from '@platejs/footnote';
import { MarkdownPlugin, remarkMdx, remarkMention, serializeMd, type SerializeMdOptions } from '@platejs/markdown';
import {markdownDisplayBlocks} from '@/plate-document';
import { KEYS } from 'platejs';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';


export const MarkdownKit = [
  BaseFootnoteReferencePlugin,
  BaseFootnoteDefinitionPlugin,
  MarkdownPlugin.configure({
    options: {
      rules: {
        equation: {
          deserialize: (node) => ({type:'equation',texExpression:node.value,numbered:node.meta==='numbered',children:[{text:''}]}),
          serialize: (node) => ({type:'math',value:node.texExpression,meta:node.numbered!==false?'numbered':undefined}),
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
    serialize:(options?:Omit<SerializeMdOptions,'editor'>)=>serializeMd(editor,{
      ...options,value:markdownDisplayBlocks(options?.value??editor.children),
    }),
  })),
];
