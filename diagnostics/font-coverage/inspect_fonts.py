import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'python-lib'))
from fontTools.ttLib import TTFont
from pypdf import PdfWriter
rows=json.loads(Path('results.json').read_text())
output=[]
pdf=PdfWriter()
for row in rows:
 f=TTFont(row['location']); cmap=f.getBestCmap(); names=f.getGlyphOrder()
 coverage={key:sum(cp in cmap for cp in rng) for key,rng in {
  'Greek-bold':range(0x1D6A8,0x1D6E2),'Greek-italic':range(0x1D6E2,0x1D71C),
  'Greek-bolditalic':range(0x1D71C,0x1D756),'Greek-sansbold':range(0x1D756,0x1D790),
  'Greek-sansbolditalic':range(0x1D790,0x1D7CA),
  'Greek-double-struck-special':[0x213C,0x213D,0x213E,0x213F,0x2140]
 }.items()}
 alpha=cmap.get(0x3B1); substitutions=[]
 if 'GSUB' in f:
  table=f['GSUB'].table
  for feature in table.FeatureList.FeatureRecord:
   for ix in feature.Feature.LookupListIndex:
    for sub in table.LookupList.Lookup[ix].SubTable:
     sub=getattr(sub,'ExtSubTable',sub)
     mapping=getattr(sub,'mapping',{})
     if alpha in mapping:substitutions.append([feature.FeatureTag,alpha,mapping[alpha]])
 name_candidates=[n for n in names if 'alpha' in n.lower() or '03b1' in n.lower()]
 output.append({'font':row['font'],'glyphs':len(names),'coverage':coverage,'alphaGlyphNames':name_candidates,'alphaGSUB':substitutions})
 pdf.append(row['job']+'.pdf')
Path('font-internals.json').write_text(json.dumps(output,indent=2))
if Path('kp-extra.pdf').exists():pdf.append('kp-extra.pdf')
pdf.write('font-comparison.pdf')
print(json.dumps(output,indent=2))
