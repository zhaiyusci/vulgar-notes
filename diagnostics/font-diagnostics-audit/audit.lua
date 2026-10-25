local output=assert(io.open('glyphs.tsv','w'))
output:write('style\tcommand\tinput\tindex\tchar\ttounicode\tfont\n')
function audit(style,command,input,box)
 local i=0
 local function walk(head)
  for n in node.traverse(head) do
   if n.id==node.id('glyph') then
    i=i+1
    local f=font.getfont(n.font)
    local c=f.characters[n.char] or {}
    output:write(table.concat({style,command,input,i,string.format('%X',n.char),tostring(c.tounicode or ''),f.fullname or f.name},'\t')..'\n')
   elseif n.id==node.id('hlist') or n.id==node.id('vlist') then walk(n.head) end
  end
 end
 walk(tex.box[box].head)
 output:flush()
end
