// SPDX-License-Identifier: GPL-3.0-or-later
import {locale} from './i18n';

// The supplied web component has Chinese source literals and no locale API.
// The pinned integration patch calls this adapter only for its own UI strings,
// never for user-provided titles, abstracts, tags, or citation keys.
const english:Record<string,string>={
  '期刊论文':'Journal article','会议论文':'Conference paper','图书':'Book','图书章节':'Book chapter','学位论文':'Thesis','报告':'Report','网页':'Web page','其他':'Other',
  '引用键不能包含空格、逗号、括号等特殊字符':'Citation keys cannot contain spaces, commas, brackets, or other reserved characters.',
  '引用键不能以 # 开头':'Citation keys cannot start with #.',
  '引用键格式无效：':'Invalid citation key: ','无法序列化此文献条目。':'Could not serialize this bibliography entry.',
  '含非 ASCII 字符：经典 BibTeX 可能无法处理，建议改成拼音或英文':'This key contains non-ASCII characters, which classic BibTeX may not support.',
  '年份需为 4 位数字':'Enter a four-digit year.','DOI 格式不正确':'Enter a valid DOI.','标题不能为空':'Enter a title.','输入为空':'The input is empty.',
  '(无法识别 key)':'(unknown key)','没有解析出任何条目':'No bibliography entries could be parsed.','IndexedDB 请求失败':'The IndexedDB request failed.',
  '[bib-library] IndexedDB 不可用，改用内存存储（刷新后丢失）':'[bib-library] IndexedDB is unavailable; using memory storage (lost on reload).',
  '无法为条目分配唯一的引用键':'Could not assign a unique citation key.','条目不存在':'This entry no longer exists.','引用键不能为空':'Enter a citation key.',
  '不是有效的库备份文件':'This is not a valid library backup.','跳过一条缺少 csl 数据的记录':'Skipped a record with missing CSL data.',
  '类型':'Type','引用键（BibTeX key）':'Citation key (BibTeX key)','留空自动生成，如 knuth1984':'Leave blank to generate a key, e.g. knuth1984',
  '年份':'Year','标题':'Title','文献标题':'Reference title','作者（每行一个）':'Authors (one per line)','Doe, Jane\n王小明':'Doe, Jane\nSmith, Alex',
  '期刊 / 会议 / 书名':'Journal / conference / book','卷':'Volume','期':'Issue','页码':'Pages','出版社':'Publisher','标签（逗号分隔）':'Tags (comma-separated)','摘要':'Abstract',
  '新建条目':'New entry','关闭':'Close','取消':'Cancel','保存':'Save','编辑条目':'Edit entry',
  '搜索引用键、标题、作者、年份…':'Search citation key, title, authors, year…','引用样式':'Citation style','+ 新建':'+ New','导入 .bib':'Import .bib',
  '备份':'Back up','恢复':'Restore','导出':'Export','还没有文献。点「导入 .bib」或把文件拖到这里。':'No references yet. Click “Import .bib” or drag a file here.',
  '清除筛选':'Clear filters','重新读取存储，查看其他人的改动':'Reload the library from storage','刷新':'Refresh','已复制':'Copied','复制失败':'Copy failed',
  '(无标题)':'(Untitled)','点击复制引用键':'Copy citation key','复制引用':'Copy citation','编辑':'Edit','详情':'Details','收起':'Collapse','删除':'Delete','，':', ',
};

/** UI messages originating in the vendor component, including its static HTML. */
export function localizeBibliographyUI(value:string):string {
  if(locale==='zh-CN')return value;
  if(english[value]!==undefined)return english[value];
  if(value.includes('<div class="toolbar">')){
    let markup=value;
    for(const [from,to]of Object.entries(english).sort((a,b)=>b[0].length-a[0].length))markup=markup.split(from).join(to);
    return markup;
  }
  const rules:[RegExp,(...parts:string[])=>string][]=[
    [/^引用键「([\s\S]*)」已被占用$/,(_,key)=>`The citation key “${key}” is already in use.`],
    [/^「([\s\S]*)」正在被另一个标签页编辑，稍后再试$/,(_,key)=>`“${key}” is being edited in another tab. Try again later.`],
    [/^删除「([\s\S]*)」？$/,(_,title)=>`Delete “${title}”?`],
    [/^引用键：([\s\S]*)$/,(_,key)=>`Citation key: ${key}`],
    [/^类型：([\s\S]*)$/,(_,type)=>`Type: ${type}`],
    [/^BibTeX 解析失败：([\s\S]*)$/,(_,detail)=>`Could not parse BibTeX: ${localizeBibliographyUI(detail)}`],
    [/^整体解析失败：([\s\S]*)$/,(_,detail)=>`Could not parse the library: ${localizeBibliographyUI(detail)}`],
    [/^条目 ([\s\S]*) 解析失败：([\s\S]*)$/,(_,key,detail)=>`Could not parse entry ${key}: ${localizeBibliographyUI(detail)}`],
    [/^条目 "([\s\S]*)" 导入失败：([\s\S]*)$/,(_,key,detail)=>`Could not import entry “${key}”: ${localizeBibliographyUI(detail)}`],
    [/^JSON 解析失败：([\s\S]*)$/,(_,detail)=>`Could not parse JSON: ${detail}`],
    [/^样式 "([\s\S]*)" 渲染失败：([\s\S]*)$/,(_,style,detail)=>`Could not render style “${style}”: ${detail}`],
    [/^导入 (\d+) 条$/,(_,count)=>`Imported ${count} entries`],
    [/^跳过 (\d+) 条重复$/,(_,count)=>`Skipped ${count} duplicates`],
    [/^(\d+) 条失败：([\s\S]*)$/,(_,count,detail)=>`${count} failed: ${localizeBibliographyUI(detail)}`],
    [/^已导出备份：(\d+) 条$/,(_,count)=>`Backup exported: ${count} entries`],
    [/^恢复 (\d+) 条$/,(_,count)=>`Restored ${count} entries`],
    [/^合并 (\d+) 条$/,(_,count)=>`Merged ${count} entries`],
    [/^搜索「([\s\S]*)」$/,(_,query)=>`Search “${query}”`],
    [/^标签 #([\s\S]*)$/,(_,tag)=>`Tag #${tag}`],
    [/^（显示前 (\d+) 条）$/,(_,count)=>` (showing the first ${count})`],
    [/^共 (\d+) 条([\s\S]*)$/,(_,count,suffix)=>`${count} entries${suffix}`],
    [/^([\s\S]*)：匹配 (\d+) 条 \/ 共 (\d+) 条([\s\S]*)$/,(_,filter,count,total,suffix)=>`${filter}: ${count} matches / ${total} entries${suffix}`],
  ];
  for(const [pattern,replace]of rules){const match=pattern.exec(value);if(match)return replace(...match);}
  return value;
}

/** A bibliography record can link to a web page, never executable URL schemes. */
export function safeBibliographyURL(value:string):string {
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
