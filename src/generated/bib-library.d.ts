export interface BibLibraryCslItem {
  id: string
  type: string
  [key: string]: unknown
}

export interface BibLibraryItem {
  id: string
  csl: BibLibraryCslItem
  tags: string[]
  collections: string[]
  addedAt: number
  updatedAt: number
  source: string
}

export declare class MemoryBackend {}

export declare class BibliographyStore {
  constructor(options?: { backend?: unknown })
  ready(): Promise<this>
  importItems(items: BibLibraryCslItem[]): Promise<{ added: BibLibraryItem[], duplicates: BibLibraryItem[], errors: string[] }>
  importBibtex(source:string, options?:{dedupe?:boolean}): Promise<{added:BibLibraryItem[],duplicates:BibLibraryItem[],errors:string[]}>
  importJson(source:string): Promise<{added:BibLibraryItem[],duplicates:BibLibraryItem[],errors:string[]}>
  get(id:string): BibLibraryItem | undefined
  update(id:string,changes:{csl?:BibLibraryCslItem;tags?:string[];collections?:string[]}):Promise<BibLibraryItem|undefined>
  renameKey(id:string,next:string):Promise<BibLibraryItem>
  remove(id:string):Promise<boolean>
  items(): BibLibraryItem[]
  search(query: string, options?: unknown): Array<{ item: BibLibraryItem, score: number, matched: string[] }>
  exportBibtex(ids?: string[]): string
  exportJson(): string
  subscribe(listener: (change: unknown) => void): () => void
  readonly size: number
}

export declare function parseBibtex(text: string): BibLibraryCslItem[]
export declare function openLibrary(options?: unknown): Promise<BibliographyStore>
export declare function toBibtex(items:readonly (BibLibraryItem|BibLibraryCslItem)[]):string
