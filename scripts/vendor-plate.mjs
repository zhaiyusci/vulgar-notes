// Copy the official MIT-licensed Plate registry, including its UI dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
const seen = new Set(), deps = new Set(['react','react-dom','platejs','@types/react','@types/react-dom','tailwindcss','@tailwindcss/cli','tw-animate-css']);
const sources=[];
async function pull(url) {
  if(seen.has(url))return; seen.add(url);
  const res=await fetch(url); if(!res.ok)throw Error(`${res.status}: ${url}`);
  const data=await res.json();sources.push(url);
  for(const dep of data.dependencies||[])deps.add(dep);
  for(const dep of data.devDependencies||[])deps.add(dep);
  for(const file of data.files||[]) {
    let dest=file.target || file.path.replace(/^src\/registry\//,'');
    dest=dest.replace(/^~\//,'').replace(/^@\//,'').replace(/^@components\//,'components/').replace(/^registry\/new-york-v4\//,'');
    if(dest.startsWith('ui/'))dest='components/'+dest;
    if(!dest.startsWith('components/')&&!dest.startsWith('hooks/')&&!dest.startsWith('lib/')){console.log('skip',dest);continue;}
    dest='src/'+dest;
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(dest,file.content);
  }
  await Promise.all((data.registryDependencies||[]).map(dep=>pull(dep.startsWith('http')?dep:`https://ui.shadcn.com/r/styles/new-york-v4/${dep}.json`)));
}
await pull('https://platejs.org/r/editor-kit.json');
await pull('https://platejs.org/r/editor.json');
await fs.writeFile('plate-vendor.json',JSON.stringify({sources,dependencies:[...deps].sort()},null,2));
console.log('Copied',sources.length,'registry items;',deps.size,'dependencies');
