// SPDX-License-Identifier: GPL-3.0-or-later
import type {Value} from 'platejs';
import {documentContentKey} from './plate-document';
import {migrateDocumentMetadata,normalizeDocumentTitles,normalizeMetadataLayout,parseDocumentMetadata} from './document-metadata';

type Envelope={version:number;value:Value};
type CachedComparison={expected:object;equal:boolean};
const omitted=(value:unknown)=>value===undefined||typeof value==='function'||typeof value==='symbol';
const jsonScalar=(value:unknown)=>omitted(value)||typeof value==='number'&&!Number.isFinite(value)?null:value;

/** Compare saved content without serializing the editor's embedded image bytes.
 * Slate nodes are immutable: an unchanged subtree can reuse its previous result,
 * including a negative result when that subtree still differs from the baseline.
 */
export class DocumentContentComparison {
  private expected:unknown;
  private comparisons=new WeakMap<object,CachedComparison>();
  private normalizedValues=new WeakMap<Value,Value>();
  private metadataSubtrees=new WeakMap<object,boolean>();
  private metadataNodes:Value=[];
  private normalizedMetadataNodes:Value=[];
  private snapshots=new Map<string,unknown>();

  constructor(savedSource:string){this.reset(savedSource);}

  /** A completed Save may describe an older snapshot than the current editor. */
  reset(savedSource:string):void {
    this.expected=JSON.parse(documentContentKey(savedSource));
    this.comparisons=new WeakMap();this.normalizedValues=new WeakMap();this.metadataSubtrees=new WeakMap();
    this.metadataNodes=[];this.normalizedMetadataNodes=[];this.snapshots.clear();
  }

  isEqual<T extends Envelope>(envelope:T):boolean {
    const current=envelope as T&Record<string,unknown>;
    let value=current.value;
    if(current.metadata!==undefined)value=migrateDocumentMetadata(value,parseDocumentMetadata(current.metadata));
    const normalizedValue=this.normalizedValues.get(value);
    if(normalizedValue)value=normalizedValue;
    else{const original=value;value=this.normalizeMetadata(value);this.normalizedValues.set(original,value);}
    const normalized:Record<string,unknown>={...current,value};delete normalized.metadata;
    return this.same(this.expected,normalized);
  }

  private containsMetadata(node:Record<string,unknown>):boolean {
    const cached=this.metadataSubtrees.get(node);if(cached!==undefined)return cached;
    const found=node.type==='document_metadata'||node.type==='metadata_entry'||
      Array.isArray(node.children)&&node.children.some(child=>this.containsMetadata(child));
    this.metadataSubtrees.set(node,found);return found;
  }

  /** Ordinary immutable prose cannot affect metadata order or title uniqueness. */
  private normalizeMetadata(value:Value):Value {
    const positions:number[]=[],nodes:Value=[];
    value.forEach((node,index)=>{if(this.containsMetadata(node)){positions.push(index);nodes.push(node);}});
    if(nodes.length!==this.metadataNodes.length||nodes.some((node,index)=>node!==this.metadataNodes[index])){
      this.metadataNodes=nodes;
      this.normalizedMetadataNodes=normalizeMetadataLayout(normalizeDocumentTitles(nodes));
    }
    let result=value;
    this.normalizedMetadataNodes.forEach((node,index)=>{
      const at=positions[index];
      if(node!==value[at]){if(result===value)result=[...value];result[at]=node;}
    });
    return result;
  }

  private snapshotRoot(source:string):unknown {
    if(this.snapshots.has(source))return this.snapshots.get(source);
    const root:unknown=JSON.parse(source).root;
    // Cursor movement creates new snapshot strings. Keep only a bounded working
    // set rather than retaining every selection position for a long session.
    if(this.snapshots.size>=128)this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(source,root);return root;
  }

  private property(object:Record<string,unknown>,key:string):unknown {
    const value=object[key];
    return key==='snapshot'&&typeof value==='string'?this.snapshotRoot(value):value;
  }

  private same(expected:unknown,actual:unknown):boolean {
    if(expected===actual)return true;
    // JSON uses null for non-finite numbers and omitted values inside arrays.
    if(typeof actual==='number'&&!Number.isFinite(actual))return expected===null;
    if(!expected||!actual||typeof expected!=='object'||typeof actual!=='object')return false;
    const cached=this.comparisons.get(actual);
    if(cached?.expected===expected)return cached.equal;
    const equal=this.compareObjects(expected,actual);
    this.comparisons.set(actual,{expected,equal});return equal;
  }

  private compareObjects(expected:object,actual:object):boolean {
    if(Array.isArray(expected)||Array.isArray(actual)){
      if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length)return false;
      for(let index=0;index<expected.length;index++)if(!this.same(expected[index],jsonScalar(actual[index])))return false;
      return true;
    }
    const left=expected as Record<string,unknown>,right=actual as Record<string,unknown>;
    const expectedKeys=Object.keys(left),keys=Object.keys(right);
    let present=0;
    for(const key of keys){
      const value=this.property(right,key);if(omitted(value))continue;
      present++;
      if(!Object.hasOwn(left,key)||!this.same(left[key],value))return false;
    }
    return present===expectedKeys.length;
  }
}
